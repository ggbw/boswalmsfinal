import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import logoImg from '@/assets/logo.jpg';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Programme { id: string; name: string; type: string; years: number; semesters: number; level?: number; }
interface Module    { id: string; name: string; code?: string; }
interface ClassItem { id: string; name: string; programme: string; year: number; semester: number; }

// ── Main component ─────────────────────────────────────────────────────────────
export default function PublicApplyPage() {
  const [step, setStep] = useState<'programmes' | 'form' | 'success'>('programmes');
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [modules, setModules]       = useState<Record<string, Module[]>>({});  // programmeId -> modules
  const [selectedProg, setSelectedProg] = useState<Programme | null>(null);
  const [expandedProg, setExpandedProg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [{ data: progs }, { data: classes }, { data: mcs }, { data: mods }] = await Promise.all([
        supabase.from('programmes').select('*'),
        supabase.from('classes').select('*'),
        supabase.from('module_classes').select('*'),
        supabase.from('modules').select('*'),
      ]);

      setProgrammes(progs || []);

      // Map modules to programmes via classes → module_classes
      const classProgMap: Record<string, string> = {};
      (classes || []).forEach((c: any) => { classProgMap[c.id] = c.programme; });

      const modMap: Record<string, string> = {};
      (mods || []).forEach((m: any) => { modMap[m.id] = m.name; });

      const progModules: Record<string, Module[]> = {};
      const seen: Record<string, Set<string>> = {};
      (mcs || []).forEach((mc: any) => {
        const progId = classProgMap[mc.class_id];
        if (!progId) return;
        if (!progModules[progId]) { progModules[progId] = []; seen[progId] = new Set(); }
        if (!seen[progId].has(mc.module_id) && modMap[mc.module_id]) {
          seen[progId].add(mc.module_id);
          progModules[progId].push({ id: mc.module_id, name: modMap[mc.module_id] });
        }
      });
      setModules(progModules);
      setLoading(false);
    };
    load();
  }, []);

  if (step === 'success') return <SuccessScreen selectedProg={selectedProg} />;

  if (step === 'form' && selectedProg) return (
    <ApplicationForm
      programme={selectedProg}
      onBack={() => setStep('programmes')}
      onSuccess={() => setStep('success')}
    />
  );

  // ── Step 1: Programme listing ─────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8' }}>
      {/* Nav */}
      <div style={{ background: '#002060', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <img src={logoImg} alt="Boswa" style={{ height: 44 }} />
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>Boswa Culinary Institute of Botswana</div>
          <div style={{ color: '#C9A227', fontSize: 11 }}>Student Admissions</div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ color: '#002060', fontSize: 26, fontWeight: 800, margin: '0 0 8px' }}>Available Programmes</h1>
          <p style={{ color: '#555', fontSize: 14 }}>Select a programme to view its modules, then apply.</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading programmes…</div>
        ) : programmes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>No programmes available at the moment.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {programmes.map(p => {
              const isExpanded = expandedProg === p.id;
              const progMods = modules[p.id] || [];
              return (
                <div key={p.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  {/* Programme header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', cursor: 'pointer' }}
                    onClick={() => setExpandedProg(isExpanded ? null : p.id)}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#002060' }}>{p.name}</div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        <Tag color="#002060">{p.type}</Tag>
                        {p.level && <Tag color="#C9A227">Level {p.level}</Tag>}
                        <Tag color="#4b5563">{p.years} {p.years === 1 ? 'Year' : 'Years'}</Tag>
                        <Tag color="#4b5563">{progMods.length} Modules</Tag>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={e => { e.stopPropagation(); setSelectedProg(p); setStep('form'); }}
                        style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        Apply Now →
                      </button>
                      <span style={{ color: '#888', fontSize: 18, lineHeight: 1 }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Module list */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #e2e8f0', padding: '16px 22px', background: '#f8fafc' }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: '#002060', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Programme Modules
                      </div>
                      {progMods.length === 0 ? (
                        <div style={{ color: '#888', fontSize: 13 }}>No modules listed yet.</div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                          {progMods.map((m, i) => (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }}>
                              <span style={{ background: '#002060', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0 }}>{i + 1}</span>
                              {m.name}
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        className="btn btn-primary"
                        style={{ marginTop: 16, fontSize: 13 }}
                        onClick={() => { setSelectedProg(p); setStep('form'); }}>
                        Apply for {p.name} →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#888' }}>
          Already have an account?{' '}
          <a href="/" style={{ color: '#002060', fontWeight: 600 }}>Sign In</a>
        </div>
      </div>
    </div>
  );
}

// ── Tag helper ────────────────────────────────────────────────────────────────
function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ background: color + '18', color, border: `1px solid ${color}44`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {children}
    </span>
  );
}

// ── Application Form ──────────────────────────────────────────────────────────
function ApplicationForm({ programme, onBack, onSuccess }: { programme: Programme; onBack: () => void; onSuccess: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '', dob: '', gender: '', nationality: 'Motswana',
    nationalId: '', mobile: '', email: '',
    guardianName: '', guardianMobile: '', guardianEmail: '',
    message: '',
  });
  const [agreed, setAgreed] = useState(false);

  const set = (field: string, val: string) => setForm(f => ({ ...f, [field]: val }));

  const handleSubmit = async () => {
    if (!form.name.trim())   { alert('Full name is required.'); return; }
    if (!form.mobile.trim()) { alert('Mobile number is required.'); return; }
    if (!agreed)             { alert('You must agree to the declaration before submitting.'); return; }

    setSubmitting(true);
    const { error } = await supabase.from('admission_enquiries').insert({
      id: 'ae_' + Date.now(),
      name: form.name.trim(),
      dob: form.dob || null,
      gender: form.gender,
      nationality: form.nationality,
      national_id: form.nationalId,
      mobile: form.mobile.trim(),
      email: form.email.trim(),
      guardian_name: form.guardianName,
      guardian_mobile: form.guardianMobile,
      guardian_email: form.guardianEmail,
      programme: programme.id,
      message: form.message,
      status: 'pending',
      date: new Date().toISOString().split('T')[0],
    });
    setSubmitting(false);
    if (error) { alert('Submission failed: ' + error.message); return; }
    onSuccess();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8' }}>
      {/* Nav */}
      <div style={{ background: '#002060', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <img src={logoImg} alt="Boswa" style={{ height: 44 }} />
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>Boswa Culinary Institute of Botswana</div>
          <div style={{ color: '#C9A227', fontSize: 11 }}>Student Admissions — Application Form</div>
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '28px 16px' }}>
        {/* Back + programme title */}
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#002060', fontSize: 13, fontWeight: 600, marginBottom: 16, padding: 0 }}>
          ← Back to Programmes
        </button>
        <div style={{ background: '#002060', borderRadius: '10px 10px 0 0', padding: '18px 24px' }}>
          <div style={{ color: '#C9A227', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Applying for</div>
          <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginTop: 2 }}>{programme.name}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Tag color="#C9A227">{programme.type}</Tag>
            {programme.level && <Tag color="#C9A227">Level {programme.level}</Tag>}
            <Tag color="#C9A227">{programme.years} {programme.years === 1 ? 'Year' : 'Years'}</Tag>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '0 0 10px 10px', padding: '28px 28px 32px', boxShadow: '0 4px 20px rgba(0,0,0,0.07)' }}>

          <FormSection title="Personal Details">
            <div className="form-row cols2">
              <div className="form-group"><label>Full Name *</label><input className="form-input" placeholder="Full name as per ID" onChange={e => set('name', e.target.value)} /></div>
              <div className="form-group"><label>Date of Birth</label><input className="form-input" type="date" onChange={e => set('dob', e.target.value)} /></div>
            </div>
            <div className="form-row cols2">
              <div className="form-group"><label>Gender</label>
                <select className="form-select" onChange={e => set('gender', e.target.value)}>
                  <option value="">— Select —</option>
                  <option>Male</option><option>Female</option><option>Other</option>
                </select>
              </div>
              <div className="form-group"><label>Nationality</label>
                <input className="form-input" defaultValue="Motswana" onChange={e => set('nationality', e.target.value)} />
              </div>
            </div>
            <div className="form-group"><label>National ID / Passport Number</label>
              <input className="form-input" placeholder="ID or passport number" onChange={e => set('nationalId', e.target.value)} />
            </div>
          </FormSection>

          <FormSection title="Contact Information">
            <div className="form-row cols2">
              <div className="form-group"><label>Mobile Number *</label><input className="form-input" placeholder="+267 7X XXX XXX" onChange={e => set('mobile', e.target.value)} /></div>
              <div className="form-group"><label>Email Address</label><input className="form-input" type="email" placeholder="optional" onChange={e => set('email', e.target.value)} /></div>
            </div>
          </FormSection>

          <FormSection title="Guardian / Next of Kin">
            <div className="form-group"><label>Guardian Full Name</label>
              <input className="form-input" placeholder="Guardian's full name" onChange={e => set('guardianName', e.target.value)} />
            </div>
            <div className="form-row cols2">
              <div className="form-group"><label>Guardian Mobile</label><input className="form-input" placeholder="+267 7X XXX XXX" onChange={e => set('guardianMobile', e.target.value)} /></div>
              <div className="form-group"><label>Guardian Email</label><input className="form-input" type="email" placeholder="optional" onChange={e => set('guardianEmail', e.target.value)} /></div>
            </div>
          </FormSection>

          <FormSection title="Additional Information">
            <div className="form-group"><label>Any additional message (optional)</label>
              <textarea className="form-input" rows={3} placeholder="Anything you'd like us to know…" onChange={e => set('message', e.target.value)} style={{ resize: 'vertical' }} />
            </div>
          </FormSection>

          {/* Declaration */}
          <DeclarationBlock applicantName={form.name} agreed={agreed} onToggle={() => setAgreed(a => !a)} />

          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 20, padding: '13px 0', fontSize: 15, fontWeight: 700 }}
            onClick={handleSubmit}
            disabled={submitting || !agreed}>
            {submitting ? 'Submitting…' : 'Submit Application'}
          </button>
          <p style={{ fontSize: 11, color: '#999', textAlign: 'center', marginTop: 8 }}>
            By submitting this form you confirm that the information provided is accurate and correct.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Form section divider ───────────────────────────────────────────────────────
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: '#002060', borderBottom: '2px solid #C9A227', paddingBottom: 5, marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Declaration block ─────────────────────────────────────────────────────────
function DeclarationBlock({ applicantName, agreed, onToggle }: { applicantName: string; agreed: boolean; onToggle: () => void }) {
  const bullets = [
    'I will abide by the Institute\'s rules.',
    'I am able to read and write English.',
    'I hold myself responsible for the payment of all fees and charges due to Bosswa each year. any arrears and interest on arrears as defined in this year\'s fee booklet; and any costs of recovery, including attorney-and-client scale fees and/or collection commission. If I do not inform Bosswa in writing of withdrawal from studies or a course by the prescribed date(s) I will be liable for full fees even if I do not make use of Bosswa facilities.',
    'Payment plans are available, and the total amount payable must be settled before the end of the academic year. If I am unable to pay my monthly installment, I understand that I can and will be removed from my classes and will only be allowed back once arrears have been settled.',
    'The onus/responsibility of settling course fees is the sole responsibility of government sponsored students, and their course fees are to be settled in full before commencement of said studies.',
    'I waive all claims against Bosswa, its staff and directors for: any damage or loss suffered while I am, or as a consequence of my being, a Bosswa student and/or arising out of loss or destruction of, or damage to any property belonging to me or any other person.',
    'I have not been expelled, rusticated or excluded from any other Institute.',
    'The information given on this form is complete and accurate. If I fail to disclose or falsely declare information (for example, non-disclosure of previous tertiary studies), this could lead to disciplinary action and/or the cancellation of my application and/or registration at Bosswa.',
    'Agree to allow Bosswa Culinary Institute of Botswana to debit my bank account monthly the above-mentioned amount on the first (1st) of each calendar month for the agreed term.',
  ];

  return (
    <div style={{ border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
      {/* Header */}
      <div style={{ background: '#002060', padding: '10px 16px' }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Declaration</div>
        <div style={{ color: '#C9A227', fontSize: 11, marginTop: 2 }}>Please read carefully and confirm your agreement</div>
      </div>

      <div style={{ padding: '16px 18px', background: '#fafafa' }}>
        <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
          Without prejudice to the terms of my application for admission, I make the following declarations:
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.6 }}>{b}</li>
          ))}
        </ul>

        {/* Signature line */}
        <div style={{ marginTop: 20, padding: '14px 16px', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 6, fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
          I,{' '}
          <span style={{ borderBottom: '1px solid #002060', minWidth: 200, display: 'inline-block', padding: '0 4px', color: applicantName ? '#002060' : '#9ca3af', fontWeight: applicantName ? 700 : 400 }}>
            {applicantName || '____________________________'}
          </span>
          , hereby formally declare the above and apply for studies at Bosswa Culinary Institute of Botswana.
        </div>

        {/* Checkbox */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={onToggle} style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: '#002060' }} />
          <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
            I have read and understood the declaration above and confirm that all information provided is accurate and complete.
          </span>
        </label>
      </div>
    </div>
  );
}

// ── Success screen ─────────────────────────────────────────────────────────────
function SuccessScreen({ selectedProg }: { selectedProg: Programme | null }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 48, maxWidth: 500, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ width: 72, height: 72, background: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 32 }}>✓</div>
        <h2 style={{ color: '#002060', marginBottom: 10, fontSize: 22 }}>Application Submitted!</h2>
        {selectedProg && (
          <div style={{ background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#3730a3' }}>
            <strong>{selectedProg.name}</strong>
          </div>
        )}
        <p style={{ color: '#555', lineHeight: 1.7, fontSize: 14 }}>
          Your application has been received and is currently under review. We will contact you once a decision has been made.
        </p>
        <div style={{ marginTop: 24, padding: '12px 16px', background: '#f8faff', borderRadius: 8, border: '1px solid #dde3f0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#002060' }}>Boswa Culinary Institute of Botswana</div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>www.boswa.ac.bw</div>
        </div>
        <a href="/" style={{ display: 'inline-block', marginTop: 20, fontSize: 13, color: '#002060', fontWeight: 600 }}>← Back to Sign In</a>
      </div>
    </div>
  );
}
