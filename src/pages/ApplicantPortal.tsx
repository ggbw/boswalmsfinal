import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import logoImg from '@/assets/logo.jpg';

interface ApplicationData {
  id: string;
  status: string;
  submitted_at: string;
  first_choice_programme: string;
  second_choice_programme?: string;
  sponsor_type?: string;
  sponsor_name?: string;
  sponsor_doc_url?: string;
  rejection_reason?: string;
  first_prog_name?: string;
  second_prog_name?: string;
}

const STATUS_STEPS = ['submitted','under_review','accepted','enrolled'] as const;

const STATUS_META: Record<string, { label:string; color:string; bg:string; icon:string; desc:string }> = {
  submitted:         { label:'Submitted',      color:'#1d4ed8', bg:'#eff6ff', icon:'📋', desc:'Your application has been received and is awaiting review.' },
  under_review:      { label:'Under Review',   color:'#b45309', bg:'#fffbeb', icon:'🔍', desc:'Your application is currently being reviewed by our admissions team.' },
  accepted:          { label:'Accepted',       color:'#15803d', bg:'#f0fdf4', icon:'🎉', desc:'Congratulations! Your application has been accepted.' },
  rejected:          { label:'Rejected',       color:'#dc2626', bg:'#fef2f2', icon:'❌', desc:'Unfortunately your application was not successful at this time.' },
  awaiting_enrollment:{ label:'Awaiting Enrollment', color:'#7c3aed', bg:'#f5f3ff', icon:'⏳', desc:'Your sponsorship details have been received. Awaiting final enrollment.' },
  enrolled:          { label:'Enrolled',       color:'#15803d', bg:'#f0fdf4', icon:'🎓', desc:'You have been enrolled. Welcome to Boswa!' },
};

export default function ApplicantPortal({ userId, onSignOut }: { userId:string; onSignOut:()=>void }) {
  const [application, setApplication] = useState<ApplicationData|null>(null);
  const [loading, setLoading]         = useState(true);
  const [view, setView]               = useState<'status'|'sponsorship'>('status');

  const load = async () => {
    setLoading(true);
    // Get applicant record by user_id
    const { data: applicant } = await supabase.from('applicants').select('id,name').eq('user_id', userId).single();
    if (!applicant) { setLoading(false); return; }

    const { data: appl } = await supabase.from('applications').select('*').eq('applicant_id', applicant.id).order('submitted_at', { ascending:false }).limit(1).single();
    if (!appl) { setLoading(false); return; }

    // Resolve programme names
    const ids = [appl.first_choice_programme, appl.second_choice_programme].filter(Boolean);
    const { data: progs } = await supabase.from('programmes').select('id,name').in('id', ids);
    const progMap: Record<string,string> = {};
    (progs||[]).forEach((p:any) => { progMap[p.id] = p.name; });

    setApplication({
      ...appl,
      first_prog_name:  progMap[appl.first_choice_programme] || appl.first_choice_programme,
      second_prog_name: appl.second_choice_programme ? progMap[appl.second_choice_programme] : undefined,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  if (loading) return (
    <Shell onSignOut={onSignOut}>
      <div style={{ textAlign:'center', padding:60, color:'#888' }}>Loading your application…</div>
    </Shell>
  );

  if (!application) return (
    <Shell onSignOut={onSignOut}>
      <div style={{ textAlign:'center', padding:60, color:'#888' }}>No application found. <a href="/apply">Apply now →</a></div>
    </Shell>
  );

  const meta = STATUS_META[application.status] || STATUS_META.submitted;

  if (view === 'sponsorship') return (
    <Shell onSignOut={onSignOut}>
      <SponsorshipForm application={application} onBack={() => setView('status')} onDone={() => { setView('status'); load(); }} />
    </Shell>
  );

  return (
    <Shell onSignOut={onSignOut}>
      <div style={{ maxWidth:720, margin:'0 auto', padding:'32px 16px' }}>

        {/* Status Banner */}
        <div style={{ background: meta.bg, border:`1px solid ${meta.color}44`, borderRadius:12, padding:'24px 28px', marginBottom:24, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:8 }}>{meta.icon}</div>
          <div style={{ fontSize:22, fontWeight:800, color: meta.color }}>{meta.label}</div>
          <div style={{ fontSize:14, color:'#555', marginTop:6, lineHeight:1.6 }}>{meta.desc}</div>
        </div>

        {/* Progress bar (not for rejected) */}
        {application.status !== 'rejected' && (
          <div style={{ background:'#fff', borderRadius:10, padding:'20px 24px', marginBottom:20, border:'1px solid #e2e8f0' }}>
            <div style={{ fontWeight:700, fontSize:13, color:'#002060', marginBottom:16 }}>Application Progress</div>
            <div style={{ display:'flex', alignItems:'center', gap:0 }}>
              {STATUS_STEPS.map((s, i) => {
                const stepMeta = STATUS_META[s];
                const done = STATUS_STEPS.indexOf(application.status as any) >= i;
                const active = application.status === s;
                return (
                  <div key={s} style={{ display:'flex', alignItems:'center', flex: i < STATUS_STEPS.length-1 ? 1 : 0 }}>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                      <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14,
                        background: done ? '#002060' : '#e5e7eb', color: done ? '#fff' : '#9ca3af',
                        border: active ? '3px solid #C9A227' : 'none', flexShrink:0 }}>
                        {done ? '✓' : i+1}
                      </div>
                      <div style={{ fontSize:10, color: done ? '#002060' : '#9ca3af', fontWeight: active ? 700 : 400, whiteSpace:'nowrap' }}>{stepMeta.label}</div>
                    </div>
                    {i < STATUS_STEPS.length-1 && (
                      <div style={{ flex:1, height:3, background: STATUS_STEPS.indexOf(application.status as any) > i ? '#002060' : '#e5e7eb', margin:'0 4px', marginBottom:18 }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Application details */}
        <div style={{ background:'#fff', borderRadius:10, padding:'20px 24px', marginBottom:20, border:'1px solid #e2e8f0' }}>
          <div style={{ fontWeight:700, fontSize:13, color:'#002060', marginBottom:14 }}>Application Details</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 24px', fontSize:13 }}>
            <Detail label="First Choice"  value={application.first_prog_name||'—'} />
            <Detail label="Second Choice" value={application.second_prog_name||'—'} />
            <Detail label="Submitted"     value={new Date(application.submitted_at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})} />
            <Detail label="Status"        value={meta.label} />
          </div>
          {application.status === 'rejected' && application.rejection_reason && (
            <div style={{ marginTop:14, background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#dc2626' }}>
              <strong>Reason:</strong> {application.rejection_reason}
            </div>
          )}
        </div>

        {/* Actions based on status */}
        {application.status === 'accepted' && (
          <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:10, padding:'20px 24px', marginBottom:20 }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#15803d', marginBottom:8 }}>🎉 You've been accepted!</div>
            <p style={{ fontSize:13, color:'#374151', marginBottom:16, lineHeight:1.6 }}>
              Download your offer letter below. Once you're ready, click <strong>"Accept Offer"</strong> to proceed and submit your sponsorship information.
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <DownloadLetterBtn applicationId={application.id} type="offer" progName={application.first_prog_name} />
              <button className="btn btn-primary" onClick={() => setView('sponsorship')}>
                Accept Offer & Submit Sponsorship →
              </button>
            </div>
          </div>
        )}

        {application.status === 'rejected' && (
          <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:10, padding:'20px 24px', marginBottom:20 }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#dc2626', marginBottom:8 }}>Application Unsuccessful</div>
            <p style={{ fontSize:13, color:'#374151', marginBottom:16, lineHeight:1.6 }}>
              You may download your rejection letter below. We encourage you to apply again in a future intake.
            </p>
            <DownloadLetterBtn applicationId={application.id} type="rejection" />
          </div>
        )}

        {application.status === 'awaiting_enrollment' && (
          <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:10, padding:'20px 24px', marginBottom:20 }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#7c3aed', marginBottom:8 }}>⏳ Awaiting Enrollment</div>
            <p style={{ fontSize:13, color:'#374151', lineHeight:1.6 }}>
              Your sponsorship details have been received. Our admissions team will review your documents and finalize your enrollment. You will be notified once the process is complete.
            </p>
          </div>
        )}

        {application.status === 'enrolled' && (
          <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:10, padding:'20px 24px' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#15803d', marginBottom:8 }}>🎓 You are enrolled!</div>
            <p style={{ fontSize:13, color:'#374151', lineHeight:1.6 }}>
              Welcome to Boswa Culinary Institute of Botswana. Your student account is now active. Please log in using your student credentials.
            </p>
            <div style={{ marginTop:12 }}>
              <DownloadLetterBtn applicationId={application.id} type="welcome" />
            </div>
          </div>
        )}

      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SPONSORSHIP FORM
// ─────────────────────────────────────────────────────────────────────────────
function SponsorshipForm({ application, onBack, onDone }: { application:ApplicationData; onBack:()=>void; onDone:()=>void }) {
  const [sponsorType, setSponsorType] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [docFile, setDocFile]         = useState<File|null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const docLabel: Record<string,string> = {
    Government:     'Government Confirmation Letter',
    'Self Sponsored': 'Proof of Payment',
    Other:          'Sponsor Letter',
  };

  const handleSubmit = async () => {
    setError('');
    if (!sponsorType)                { setError('Please select a sponsor type.'); return; }
    if (sponsorType === 'Other' && !sponsorName.trim()) { setError('Please specify your sponsor.'); return; }
    if (!docFile)                    { setError('Please upload the required document.'); return; }

    setSubmitting(true);
    try {
      const path = `sponsorship/${application.id}_${Date.now()}`;
      await supabase.storage.from('applicant-docs').upload(path, docFile);

      await supabase.from('applications').update({
        sponsor_type: sponsorType,
        sponsor_name: sponsorType === 'Other' ? sponsorName : sponsorType,
        sponsor_doc_url: path,
        status: 'awaiting_enrollment',
      }).eq('id', application.id);

      // Notify admins
      await supabase.from('notifications').insert({
        id: 'notif_' + Date.now(),
        title: 'Sponsorship Submitted',
        body: `An accepted applicant has submitted their sponsorship documents and is awaiting enrollment.`,
        date: new Date().toISOString().split('T')[0],
        priority: 'high',
        author: 'System',
      });

      onDone();
    } catch(e:any) {
      setError(e.message || 'Submission failed.');
    }
    setSubmitting(false);
  };

  return (
    <div style={{ maxWidth:620, margin:'0 auto', padding:'32px 16px' }}>
      <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', color:'#002060', fontSize:13, fontWeight:600, marginBottom:16, padding:0 }}>← Back to Application Status</button>

      <div style={{ background:'#002060', borderRadius:'10px 10px 0 0', padding:'18px 24px' }}>
        <div style={{ color:'#C9A227', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5 }}>Accept Offer</div>
        <div style={{ color:'#fff', fontSize:18, fontWeight:800, marginTop:2 }}>Sponsorship Information</div>
      </div>

      <div style={{ background:'#fff', borderRadius:'0 0 10px 10px', padding:'28px', boxShadow:'0 4px 20px rgba(0,0,0,0.07)' }}>
        {error && <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'10px 14px', color:'#dc2626', fontSize:13, marginBottom:16 }}>{error}</div>}

        <div className="form-group">
          <label>Sponsor Type *</label>
          <select className="form-select" onChange={e=>setSponsorType(e.target.value)}>
            <option value="">— Select sponsor type —</option>
            <option>Government</option>
            <option>Self Sponsored</option>
            <option>Other</option>
          </select>
        </div>

        {sponsorType === 'Other' && (
          <div className="form-group">
            <label>Specify Sponsor *</label>
            <input className="form-input" placeholder="e.g. Company name, organisation…" onChange={e=>setSponsorName(e.target.value)} />
          </div>
        )}

        {sponsorType && (
          <>
            <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#555', marginBottom:12 }}>
              {sponsorType === 'Government'      && 'Please upload your government confirmation/sponsorship letter.'}
              {sponsorType === 'Self Sponsored'  && 'Please upload your proof of payment (bank receipt, transfer confirmation, etc.).'}
              {sponsorType === 'Other'           && 'Please upload your sponsor letter confirming financial support.'}
            </div>
            <div className="form-group">
              <label>{docLabel[sponsorType] || 'Supporting Document'} *</label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <button type="button" className="btn btn-outline" onClick={()=>fileRef.current?.click()}>
                  <i className="fa-solid fa-upload" style={{ marginRight:6 }} />
                  {docFile ? docFile.name : 'Choose File'}
                </button>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:'none' }} onChange={e=>setDocFile(e.target.files?.[0]||null)} />
                {docFile && <span style={{ fontSize:12, color:'#16a34a' }}>✓ {docFile.name}</span>}
              </div>
            </div>
          </>
        )}

        <button className="btn btn-primary" style={{ width:'100%', marginTop:16, padding:'12px 0', fontSize:14, fontWeight:700 }}
          onClick={handleSubmit} disabled={submitting || !sponsorType}>
          {submitting ? 'Submitting…' : 'Submit Sponsorship Information'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LETTER DOWNLOAD BUTTON
// ─────────────────────────────────────────────────────────────────────────────
function DownloadLetterBtn({ applicationId, type, progName }: { applicationId:string; type:'offer'|'rejection'|'welcome'; progName?:string }) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      // Fetch application + applicant + programme + school config in parallel
      const [applRes, configRes] = await Promise.all([
        supabase.from('applications').select('*').eq('id', applicationId).single(),
        supabase.from('school_config').select('offer_letter_signatory,offer_letter_signatory_title,offer_letter_signature_url,letter_date,wl_uniform_open,wl_uniform_close,wl_reg_start,wl_reg_end,wl_induction,wl_classes_start').eq('id', 1).single(),
      ]);
      const appl = applRes.data;
      const [applicantRes, progRes] = await Promise.all([
        supabase.from('applicants').select('*').eq('id', appl.applicant_id).single(),
        supabase.from('programmes').select('name,type,years,intake_month').eq('id', appl.first_choice_programme).single(),
      ]);
      const applicant = applicantRes.data;
      const prog = progRes.data
        ? progRes.data
        : { name: progName || '—', type: '', years: 3, intake_month: 7 };
      const cfg = configRes.data;

      const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
      const today = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
      // Each letter uses the relevant event date from the application record
      const offerDate      = appl.decided_at  ? fmt(appl.decided_at)  : today;
      const rejectionDate  = appl.decided_at  ? fmt(appl.decided_at)  : today;
      const enrollmentDate = appl.enrolled_at ? fmt(appl.enrolled_at) : today;
      const logoAbsUrl = new URL(logoImg, window.location.href).href;
      const signatory = {
        name: cfg?.offer_letter_signatory || 'Ms Claudette Latifa Ziteyo',
        title: cfg?.offer_letter_signatory_title || 'School Administration Manager',
        signatureUrl: cfg?.offer_letter_signature_url || '',
      };
      const welcomeDates = {
        uniformOpen:  cfg?.wl_uniform_open  ? fmt(cfg.wl_uniform_open)  : '26th January 2026',
        uniformClose: cfg?.wl_uniform_close ? fmt(cfg.wl_uniform_close) : '30th January 2026',
        regStart:     cfg?.wl_reg_start     ? fmt(cfg.wl_reg_start)     : '26th January 2026',
        regEnd:       cfg?.wl_reg_end       ? fmt(cfg.wl_reg_end)       : '30th January 2026',
        induction:    cfg?.wl_induction     ? fmt(cfg.wl_induction)     : '17th February 2026',
        classesStart: cfg?.wl_classes_start ? fmt(cfg.wl_classes_start) : '23rd February 2026',
      };
      const html = type === 'offer'
        ? buildOfferHtml(applicant, prog, offerDate, logoAbsUrl, signatory)
        : type === 'welcome'
        ? buildWelcomeHtml(applicant, enrollmentDate, logoAbsUrl, welcomeDates)
        : buildRejectionHtml(applicant, prog, rejectionDate, appl.rejection_reason);

      // Open print window
      const win = window.open('','_blank');
      if (!win) return;
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); }, 500);
    } catch(e) {
      alert('Could not generate letter. Please try again.');
    }
    setLoading(false);
  };

  return (
    <button className="btn btn-outline" onClick={handleDownload} disabled={loading}>
      <i className="fa-solid fa-file-pdf" style={{ marginRight:6 }} />
      {loading ? 'Generating…' : `Download ${type === 'offer' ? 'Offer' : type === 'welcome' ? 'Welcome' : 'Rejection'} Letter`}
    </button>
  );
}

function buildOfferHtml(applicant:any, prog:any, date:string, logoUrl:string, signatory:{name:string;title:string;signatureUrl:string}) {
  const durationYears = prog?.years || 3;
  const currentYear = new Date().getFullYear();
  // Diplomas always start July. Certificates use their configured intake_month (1=Jan, 7=Jul).
  const intakeMonth: number = prog?.type === 'Diploma' ? 7 : (prog?.intake_month ?? 7);
  const monthName = intakeMonth === 1 ? 'January' : 'July';
  const commenceDate = `27th ${monthName} ${currentYear}`;
  const endDate = `27th ${monthName} ${currentYear + durationYears}`;
  const durationText = durationYears === 1 ? 'one-year (1)' : durationYears === 2 ? 'two-years (2)' : durationYears === 3 ? 'three-years (3)' : `${durationYears}-years (${durationYears})`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Acceptance Letter</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;margin:0;padding:0;color:#222;line-height:1.7;font-size:13.5px}
    .page{max-width:700px;margin:0 auto;padding:0 50px 40px}
    /* Top navy bar */
    .top-bar{background:#002060;height:12px;width:100%}
    /* Header */
    .header{border-bottom:2px solid #C9A227;padding:18px 0 14px;margin-bottom:24px;text-align:center}
.school-name{font-size:17px;font-weight:900;color:#002060;letter-spacing:1px;display:block}
    .school-sub{font-size:11px;color:#555;display:block}
    /* Contact bar */
    .contact-bar{display:flex;gap:18px;font-size:10.5px;color:#444;border-top:1px solid #ddd;padding-top:8px;margin-top:8px;flex-wrap:wrap;justify-content:center}
    /* Body */
    .body{padding-top:10px}
    p{margin:10px 0}
    .re-line{text-align:center;font-weight:700;color:#002060;font-size:13.5px;border-bottom:2px solid #C9A227;padding-bottom:6px;margin:20px 0}
    .sig-block{margin-top:50px}
    .sig-line{border-bottom:1px solid #333;width:200px;margin:30px 0 6px}
    /* Footer */
    .footer{margin-top:40px;border-top:1px solid #ddd;padding-top:8px;display:flex;gap:18px;font-size:10px;color:#555;flex-wrap:wrap;justify-content:center}
    .bottom-bar{background:#002060;height:8px;width:100%;margin-top:14px}
    @media print{body{margin:0}.top-bar,.bottom-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#002060!important}}
  </style></head>
  <body>
  <div class="top-bar"></div>
  <div class="page">
    <div class="header">
      <img src="${logoUrl}" alt="Boswa Logo" style="height:60px;margin-bottom:6px;display:block;margin-left:auto;margin-right:auto" />
      <span class="school-name">BOSWA</span>
      <span class="school-sub">Bosswa Culinary Institute of Botswana</span>
      <div class="contact-bar">
        <span>&#9742; +267 686 0262</span>
        <span>&#9990; +267 686 0261</span>
        <span>&#9993; info@boswa.ac.bw</span>
        <span>&#9632; Plot 2830, Sedie &bull; Maun</span>
        <span>&#9993; P O Box 661 &bull; Maun</span>
      </div>
    </div>

    <div class="body">
      <p>${date}</p>
      <p>Att: <strong>${applicant.name}</strong><br>Cell: ${applicant.mobile || '—'}</p>
      <br/>
      <p><strong>Dear ${applicant.name}</strong></p>

      <div class="re-line">RE: &nbsp; ACCEPTANCE LETTER &ndash; ${(prog?.name || '').toUpperCase()}</div>

      <p>It is with great pleasure to welcome you as a student at Bosswa Culinary Institute of Botswana based in Maun the gateway to the Okavango Delta. Congratulations on being accepted into our <strong>${prog?.name || '—'}</strong> program which is a ${durationText} program. This course commences on ${commenceDate} and ends on ${endDate}.</p>

      <p>Let us start off by thanking you for enrolling with us. We commit to giving you a culinary experience that will give you a culinary qualification that will be recognised internationally. Our lecturers are committed to parting with knowledge and experience that they have earned over many years of work in the industry.</p>

      <p>Please note that this is a provisional acceptance and your studies will only commence once you have managed to comply with our payment terms. This could be either by sourcing financing from the Department of Tertiary Education Funding (DTEF) or by self-sponsoring or through a sponsor.</p>

      <p>You may now take this letter to the next step and apply for sponsorship through DTEF (www.tef.gov.bw) or source funding. If you are self-sponsoring or you have a sponsor, please contact our accounts department to enquire about our payment terms that are available @ admin@boswa.ac.bw.</p>

      <p>We are so excited to have you as our student and look forward to a fruitful relationship.</p>

      <p>Thank you.</p>
      <p>Yours Faithfully</p>

      <div class="sig-block">
        ${signatory.signatureUrl
          ? `<img src="${signatory.signatureUrl}" alt="Signature" style="max-height:70px;max-width:220px;display:block;margin-bottom:4px" />`
          : '<div class="sig-line"></div>'}
        <p><strong>${signatory.name}</strong><br>${signatory.title}</p>
      </div>
    </div>

    <div class="footer">
      <span>&#9742; +267 686 0262</span>
      <span>&#9990; +267 686 0261</span>
      <span>&#9993; info@boswa.ac.bw</span>
      <span>&#9632; Plot 2830, Sedie &bull; Maun</span>
      <span>&#9993; P O Box 661 &bull; Maun</span>
    </div>
    <div style="text-align:center;font-size:10px;color:#555;margin-top:6px">www.boswa.ac.bw &bull; Bosswa Culinary Institute of Botswana</div>
  </div>
  <div class="bottom-bar"></div>
  </body></html>`;
}

function buildRejectionHtml(applicant:any, prog:any, date:string, reason?:string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rejection Letter</title>
  <style>body{font-family:Arial,sans-serif;margin:60px;color:#222;line-height:1.7}
  .header{text-align:center;border-bottom:3px solid #C9A227;padding-bottom:20px;margin-bottom:30px}
  .logo{font-size:20px;font-weight:800;color:#002060}
  .sub{font-size:13px;color:#C9A227;font-style:italic}
  h2{color:#dc2626}p{margin:12px 0}
  .sig{margin-top:60px}.line{border-bottom:1px solid #000;width:220px;margin-top:40px}
  </style></head><body>
  <div class="header"><div class="logo">BOSWA CULINARY INSTITUTE OF BOTSWANA</div><div class="sub">Official Letter</div></div>
  <p>${date}</p>
  <p>Dear <strong>${applicant.name}</strong>,</p>
  <h2>APPLICATION OUTCOME</h2>
  <p>Thank you for your interest in studying at Boswa Culinary Institute of Botswana and for taking the time to apply for the <strong>${prog?.name || '—'}</strong> programme.</p>
  <p>After careful consideration, we regret to inform you that your application has been <strong>unsuccessful</strong> for the current intake.</p>
  ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
  <p>We encourage you to apply again in a future intake. If you have any questions, please do not hesitate to contact our admissions office.</p>
  <p>We wish you every success in your future endeavours.</p>
  <p>Yours sincerely,</p>
  <div class="sig"><div class="line"></div><p><strong>Admissions Office</strong><br>Boswa Culinary Institute of Botswana</p></div>
  </body></html>`;
}

function buildWelcomeHtml(applicant:any, date:string, logoUrl:string, d:{uniformOpen:string;uniformClose:string;regStart:string;regEnd:string;induction:string;classesStart:string}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Welcome Letter</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;margin:0;padding:0;color:#222;line-height:1.7;font-size:13.5px}
    .page{max-width:700px;margin:0 auto;padding:0 60px 40px}
    .header{text-align:center;padding:30px 0 20px}
    .re-line{font-weight:700;text-decoration:underline;margin:20px 0 14px}
    p{margin:10px 0}
    ul{margin:8px 0 8px 20px;padding:0}
    ul li{margin:4px 0}
    .quote{font-style:italic}
    .next-steps{font-weight:700;margin-top:18px}
    ol{margin:8px 0 8px 20px;padding:0}
    ol li{margin:6px 0}
    .sig-block{margin-top:40px}
    .sig-line{border-bottom:1px solid #333;width:200px;margin:30px 0 6px}
    .footer{margin-top:40px;border-top:1px solid #ccc;padding-top:10px;display:flex;gap:18px;font-size:10px;color:#555;flex-wrap:wrap;justify-content:center}
    .footer-web{text-align:center;font-size:10px;color:#555;margin-top:4px}
    @media print{body{margin:0}}
  </style></head>
  <body>
  <div class="page">
    <div class="header">
      <img src="${logoUrl}" alt="Boswa Logo" style="height:80px;margin-bottom:4px" />
    </div>

    <p>${date}</p>
    <p><strong>Att: ${applicant.name}</strong><br><strong>ID: ${applicant.national_id || '—'}</strong></p>
    <br/>
    <p><strong>Dear: ${applicant.name}</strong></p>

    <div class="re-line">RE: WELCOME LETTER</div>

    <p>Welcome to all new fellow culinarians! We welcome you to the wonderful world of culinary arts.</p>

    <p>This is where your life will now start and your future career will begin. We are always trying to improve, and this year we have a whole BUNCH of changes to make your culinary education more powerful and to better prepare you for industry when you graduate.</p>

    <p>Everything you do in class and every homework assignment you have to complete does one of two things:</p>
    <ul>
      <li>Prepares you for a career in the hospitality industry as a professional chef</li>
      <li>It helps you grow as an individual in this demanding career</li>
    </ul>

    <p>Good luck for the upcoming years and I leave you with a quote to remember by a famous Chef Anthony Bourdain</p>
    <p class="quote">&ldquo;Food is everything we are. It&rsquo;s an extension of naturalist feeling, ethnic feeling, your personal history, your region, your tribe, your grandma. Its inseparable from those from the get go&rdquo;</p>

    <p class="next-steps">We are pleased to let you know what the next steps are:</p>
    <ol>
      <li>Uniform Fitting will be open from ${d.uniformOpen} (Contact our Student Support Office Mr. Oathusa on +267 686 0261 or 71 995 523 to make an appointment). Uniform fitting will close on ${d.uniformClose}.</li>
      <li>Registration will start during the week of ${d.regStart} to ${d.regEnd}. You will receive a registration document electronically which you will be required to fill out and send back to us as soon as possible.</li>
      <li>Induction will be held on ${d.induction}</li>
      <li>Classes will start on ${d.classesStart}.</li>
    </ol>

    <p>We cannot wait to have you on campus!</p>

    <p><strong>Yours Faithfully</strong></p>
    <div class="sig-block">
      <div class="sig-line"></div>
      <p><strong>Mr. Boisi Dibuile</strong><br><strong>Deputy Principal &amp; Head of Academics</strong></p>
    </div>

    <div class="footer">
      <span>&#9742; + 267 686 0262</span>
      <span>&#9783; + 267 686 0261</span>
      <span>&#9993; info@boswa.ac.bw</span>
      <span>&#9650; Plot 2830, Sedie Ward, Maun</span>
      <span>&#9993; PO Box 752, Maun</span>
    </div>
    <div class="footer-web">www.boswa.ac.bw</div>
  </div>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHELL
// ─────────────────────────────────────────────────────────────────────────────
function Shell({ children, onSignOut }: { children:React.ReactNode; onSignOut:()=>void }) {
  return (
    <div style={{ minHeight:'100vh', background:'#f0f4f8' }}>
      <div style={{ background:'#002060', padding:'14px 32px', display:'flex', alignItems:'center', gap:16 }}>
        <img src={logoImg} alt="Boswa" style={{ height:44 }} />
        <div>
          <div style={{ color:'#fff', fontWeight:800, fontSize:15 }}>Boswa Culinary Institute of Botswana</div>
          <div style={{ color:'#C9A227', fontSize:11 }}>Applicant Portal</div>
        </div>
        <div style={{ marginLeft:'auto' }}>
          <button onClick={onSignOut} style={{ background:'none', border:'1px solid rgba(255,255,255,0.3)', color:'#fff', padding:'6px 14px', borderRadius:6, cursor:'pointer', fontSize:12 }}>
            Sign Out
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label:string; value:string }) {
  return (
    <div>
      <div style={{ fontSize:11, color:'#888' }}>{label}</div>
      <div style={{ fontWeight:600, marginTop:2 }}>{value}</div>
    </div>
  );
}
