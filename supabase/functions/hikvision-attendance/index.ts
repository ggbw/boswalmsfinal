import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, deviceId, fromDate, toDate } = body

    const HIK_BASE = 'https://ieu.hik-connect.com'
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })

    // ── ACTION: LOGIN (Hik-Connect cloud, server-side — no CORS) ─────
    if (action === 'login') {
      const { email, password } = body
      const res = await fetch(`${HIK_BASE}/v3/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginType: 'Hik-Connect', account: email, password }),
      })
      const data = await res.json()
      if (!res.ok) return json({ success: false, error: `Login failed: ${res.status}` })
      const token: string =
        data?.loginSession?.sessionId ??
        data?.data?.accessToken ??
        data?.accessToken ?? ''
      if (!token) return json({ success: false, error: 'No token in Hik-Connect response' })
      return json({ success: true, token })
    }

    // ── ACTION: ATTENDANCE (Hik-Connect cloud, server-side — no CORS) ─
    if (action === 'attendance') {
      const { token, deviceSerial, startTime, endTime } = body
      const url =
        `${HIK_BASE}/v1/attendance/records?` +
        `deviceSerial=${deviceSerial}&` +
        `startTime=${encodeURIComponent(startTime)}&` +
        `endTime=${encodeURIComponent(endTime)}&` +
        `pageNo=1&pageSize=200`
      const res = await fetch(url, {
        headers: {
          'Authorization':  `Bearer ${token}`,
          'X-Access-Token': token,
          'Content-Type':   'application/json',
        },
      })
      const data = await res.json()
      if (!res.ok) return json({ success: false, error: `Attendance fetch failed: ${res.status}` })
      const records = data?.data?.list ?? data?.data ?? data?.records ?? []
      return json({ success: true, records })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch device credentials from DB
    const { data: device, error } = await supabase
      .from('attendance_devices')
      .select('*')
      .eq('id', deviceId)
      .single()

    if (error || !device) {
      return new Response(
        JSON.stringify({ success: false, message: 'Device not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const baseUrl = `http://${device.device_ip}:${device.port}/ISAPI`

    // Helper: HTTP Digest Auth fetch
    async function digestFetch(url: string, options: any = {}) {
      const firstRes = await fetch(url, { ...options })

      if (firstRes.status !== 401) return firstRes

      const wwwAuth = firstRes.headers.get('WWW-Authenticate') || ''
      const realm = wwwAuth.match(/realm="([^"]+)"/)?.[1] || ''
      const nonce = wwwAuth.match(/nonce="([^"]+)"/)?.[1] || ''
      const qop   = wwwAuth.match(/qop="([^"]+)"/)?.[1] || ''

      const method = options.method || 'GET'
      const uri    = new URL(url).pathname + new URL(url).search

      function md5(str: string): string {
        function safeAdd(x: number, y: number) { const lsw=(x&0xFFFF)+(y&0xFFFF); const msw=(x>>16)+(y>>16)+(lsw>>16); return (msw<<16)|(lsw&0xFFFF) }
        function bitRotateLeft(num: number, cnt: number) { return (num<<cnt)|(num>>>(32-cnt)) }
        function md5cmn(q:number,a:number,b:number,x:number,s:number,t:number){return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b)}
        function md5ff(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return md5cmn((b&c)|((~b)&d),a,b,x,s,t)}
        function md5gg(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return md5cmn((b&d)|(c&(~d)),a,b,x,s,t)}
        function md5hh(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return md5cmn(b^c^d,a,b,x,s,t)}
        function md5ii(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return md5cmn(c^(b|(~d)),a,b,x,s,t)}
        function str2binl(s: string) {
          const bin: number[] = []
          const mask = (1<<8)-1
          for (let i=0;i<s.length*8;i+=8) bin[i>>5]|=(s.charCodeAt(i/8)&mask)<<(i%32)
          return bin
        }
        function binl2hex(binarray: number[]) {
          const hexTab='0123456789abcdef'; let str=''
          for (let i=0;i<binarray.length*4;i++) str+=hexTab.charAt((binarray[i>>2]>>((i%4)*8+4))&0xF)+hexTab.charAt((binarray[i>>2]>>((i%4)*8))&0xF)
          return str
        }
        function coreMd5(x: number[], len: number) {
          x[len>>5]|=0x80<<((len)%32); x[(((len+64)>>>9)<<4)+14]=len
          let a=1732584193,b=-271733879,c=-1732584194,d=271733878
          for (let i=0;i<x.length;i+=16) {
            const [oa,ob,oc,od]=[a,b,c,d]
            a=md5ff(a,b,c,d,x[i+0],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330)
            a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983)
            a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162)
            a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329)
            a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i+0],20,-373897302)
            a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848)
            a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501)
            a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734)
            a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556)
            a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640)
            a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i+0],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189)
            a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651)
            a=md5ii(a,b,c,d,x[i+0],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055)
            a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799)
            a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649)
            a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551)
            a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od)
          }
          return [a,b,c,d]
        }
        const binl = str2binl(str)
        return binl2hex(coreMd5(binl, str.length*8))
      }

      const nc     = '00000001'
      const cnonce = crypto.randomUUID().replace(/-/g, '').substring(0, 8)

      const ha1 = md5(`${device.device_user}:${realm}:${device.device_password}`)
      const ha2 = md5(`${method}:${uri}`)
      const response = qop
        ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${nonce}:${ha2}`)

      const authHeader = qop
        ? `Digest username="${device.device_user}", realm="${realm}", ` +
          `nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, ` +
          `cnonce="${cnonce}", response="${response}"`
        : `Digest username="${device.device_user}", realm="${realm}", ` +
          `nonce="${nonce}", uri="${uri}", response="${response}"`

      return fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        }
      })
    }

    // ── ACTION: TEST CONNECTION ──────────────────────────────────────
    if (action === 'test') {
      try {
        const res = await digestFetch(`${baseUrl}/System/deviceInfo`, { method: 'GET' })
        if (res.ok) {
          await supabase
            .from('attendance_devices')
            .update({ last_sync: new Date().toISOString() })
            .eq('id', deviceId)
          return new Response(
            JSON.stringify({ success: true, message: 'Device connected successfully' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        return new Response(
          JSON.stringify({ success: false, message: `Device returned status ${res.status}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, message: `Connection failed: ${e}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── ACTION: DOWNLOAD ATTENDANCE ──────────────────────────────────
    if (action === 'download') {
      const acsUrl = `${baseUrl}/AccessControl/AcsEvent?format=json`

      async function fetchEvents(major: number, minor: number) {
        const events: any[] = []
        let position = 0
        const limit = 30

        while (true) {
          const body = JSON.stringify({
            AcsEventCond: {
              searchID: `${position}`,
              searchResultPosition: position,
              maxResults: limit,
              major,
              minor,
              startTime: fromDate + '+02:00',
              endTime:   toDate   + '+02:00',
            }
          })
          const res = await digestFetch(acsUrl, { method: 'POST', body })
          if (!res.ok) break
          const data = await res.json()
          const list = data?.AcsEvent?.InfoList || []
          if (!list.length) break
          events.push(...list)
          position += limit
          if (list.length < limit) break
        }
        return events
      }

      const faceEvents = await fetchEvents(5, 75)
      const fpEvents   = await fetchEvents(5, 38)
      const allEvents  = [...faceEvents, ...fpEvents]

      if (!allEvents.length) {
        return new Response(
          JSON.stringify({ success: true, count: 0, message: 'No attendance records found for this period' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      let inserted = 0
      for (const event of allEvents) {
        const biometricId = event.employeeNoString || event.employeeNo
        if (!biometricId) continue

        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('biometric_id', String(biometricId))
          .single()

        const punchTime = new Date(event.time).toISOString()
        const method    = event.FaceRect ? 'face' : 'fingerprint'

        const tenMinBefore = new Date(new Date(punchTime).getTime() - 10 * 60000).toISOString()
        const tenMinAfter  = new Date(new Date(punchTime).getTime() + 10 * 60000).toISOString()

        const { data: existing } = await supabase
          .from('attendance_records')
          .select('id')
          .eq('biometric_id', String(biometricId))
          .gte('punch_time', tenMinBefore)
          .lte('punch_time', tenMinAfter)
          .limit(1)

        if (existing && existing.length > 0) continue

        await supabase.from('attendance_records').insert({
          employee_id:  emp?.id || null,
          biometric_id: String(biometricId),
          device_id:    deviceId,
          device_name:  device.name,
          punch_time:   punchTime,
          punch_type:   'unknown',
          method,
          raw_event:    event,
        })
        inserted++
      }

      // Calculate check_in / check_out per employee per day
      const { data: records } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('device_id', deviceId)
        .gte('punch_time', new Date(fromDate).toISOString())
        .lte('punch_time', new Date(toDate).toISOString())
        .order('punch_time', { ascending: true })

      const grouped: Record<string, any[]> = {}
      for (const r of records || []) {
        const day = r.punch_time.substring(0, 10)
        const key = `${r.biometric_id}_${day}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(r)
      }

      for (const [, recs] of Object.entries(grouped)) {
        recs.sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime())
        for (let i = 0; i < recs.length; i++) {
          await supabase
            .from('attendance_records')
            .update({ punch_type: i % 2 === 0 ? 'check_in' : 'check_out' })
            .eq('id', recs[i].id)
        }
        if (recs.length >= 2) {
          const checkIn  = new Date(recs[0].punch_time).getTime()
          const checkOut = new Date(recs[recs.length - 1].punch_time).getTime()
          const hours = Math.round(((checkOut - checkIn) / 3600000) * 100) / 100
          await supabase
            .from('attendance_records')
            .update({ check_in: recs[0].punch_time, check_out: recs[recs.length - 1].punch_time, work_hours: hours })
            .eq('id', recs[0].id)
        }
      }

      await supabase
        .from('attendance_devices')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', deviceId)

      return new Response(
        JSON.stringify({ success: true, count: inserted, message: `Downloaded ${inserted} new records` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: false, message: 'Unknown action' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, message: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
