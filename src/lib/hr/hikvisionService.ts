import { supabase } from "@/integrations/supabase/client";

export async function testHikvisionConnection(
  deviceId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("hikvision-attendance", {
      body: { action: "test", deviceId },
    });
    if (error) return { success: false, message: error.message };
    return data as { success: boolean; message: string };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

export async function downloadHikvisionAttendance(
  deviceId: string,
  fromDate: string,
  toDate: string
): Promise<{ success: boolean; count: number; message: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("hikvision-attendance", {
      body: { action: "download", deviceId, fromDate, toDate },
    });
    if (error) return { success: false, count: 0, message: error.message };
    return data as { success: boolean; count: number; message: string };
  } catch (e) {
    return { success: false, count: 0, message: String(e) };
  }
}
