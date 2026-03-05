export interface Student {
  id: string; studentId: string; name: string; gender: string; dob: string;
  mobile: string; classId: string; guardian: string; programme: string;
  year: number; semester: number; status: string; email?: string;
  progressionStatus?: string;
}
export interface User {
  id: string; username: string; password: string; role: string; name: string;
  changed: boolean; email?: string; dept: string; code?: string;
  studentRef?: string; studentId?: string;
}
export interface ClassItem {
  id: string; name: string; programme: string; year: number; semester: number;
  calYear: number; division: string; lecturer: string;
}
export interface Module {
  id: string; code: string; name: string; dept: string; classes: string[];
}
export interface Mark {
  studentId: string; moduleId: string; classId: string;
  test1: number; test2: number; practTest: number; indAss: number; grpAss: number;
  finalExam: number; practical: number; year: number; semester: number;
}
export interface Exam {
  id: string; name: string; moduleId: string; classId: string; date: string;
  status: string; type?: string;
}
export interface Assignment {
  id: string; title: string; moduleId: string; classId: string; dueDate: string;
  marks: number; status: string; description?: string; instructions?: string;
  attachmentName?: string | null; attachmentData?: string | null;
  uploadedBy?: string; uploadedDate?: string;
}
export interface Submission {
  id: string; assignmentId: string; studentId: string; submittedDate: string;
  submittedTime: string; fileName: string; fileData?: string; fileSize?: string;
  notes: string; status: string; grade: number | null; feedback: string;
}
export interface Notification {
  id: string; title: string; body: string; date: string; priority: string; author: string;
}
export interface AttendanceRecord {
  studentId: string; classId: string; date: string; status: string;
}
export interface Department {
  id: string; name: string; hod: string;
}
export interface Programme {
  id: string; name: string; years: number; semesters: number; type: string; startYear: number;
}
export interface Term {
  id: string; name: string; semesterId: number; startDate: string; endDate: string;
}
export interface TimetableSlot {
  id: string; classId: string; day: string; time: string; moduleId: string; room: string;
}
export interface AdmissionEnquiry {
  id: string; name: string; programme: string; status: string; date: string;
  dob?: string; gender?: string; mobile?: string;
}
export interface StudentModuleOverride {
  studentId: string; moduleId: string; addedBy: string; addedAt: string;
}

export interface DB {
  config: {
    schoolName: string; currentYear: number; currentSemester: number;
    programmes: Programme[];
  };
  departments: Department[];
  users: User[];
  classes: ClassItem[];
  modules: Module[];
  students: Student[];
  marks: Mark[];
  attendance: AttendanceRecord[];
  studentModules: StudentModuleOverride[];
  exams: Exam[];
  assignments: Assignment[];
  submissions: Submission[];
  timetable: TimetableSlot[];
  notifications: Notification[];
  admissionEnquiries: AdmissionEnquiry[];
}

export function createInitialDB(): DB {
  const db: DB = {
    config: {
      schoolName: 'Boswa Culinary Institute of Botswana',
      currentYear: 2026, currentSemester: 1,
      programmes: [
        { id: 'DIPL2023', name: 'Diploma in Culinary Arts', years: 3, semesters: 2, type: 'Diploma', startYear: 2023 },
        { id: 'DIPL2024', name: 'Diploma in Culinary Arts', years: 3, semesters: 2, type: 'Diploma', startYear: 2024 },
        { id: 'DIPL2025', name: 'Diploma in Culinary Arts', years: 3, semesters: 2, type: 'Diploma', startYear: 2025 },
        { id: 'CERT2025', name: 'Certificate in Culinary Arts', years: 1, semesters: 2, type: 'Certificate', startYear: 2025 },
      ]
    },
    departments: [
      { id: 'ADM', name: 'Administration', hod: 'Julia' },
      { id: 'ADMIN_OPS', name: 'Admin & Operations', hod: 'Malcom' },
      { id: 'CULH', name: 'Culinary & Hospitality', hod: 'Bonang Keabetswe' },
      { id: 'CULP', name: 'Culinary Practicals', hod: 'Poneso Kgakge' },
    ],
    users: [
      { id: 'u001', username: 'admin', password: 'password', role: 'admin', name: 'Admin Julia', changed: false, email: 'admin@boswa.ac.bw', dept: 'ADM' },
      { id: 'u002', username: 'malcom', password: 'password', role: 'hoy', name: 'Malcom', changed: false, email: 'malcom@boswa.ac.bw', dept: 'ADMIN_OPS' },
      { id: 'u003', username: 'bonang', password: 'password', role: 'hod', name: 'Bonang Keabetswe', changed: false, email: 'bonang@boswa.ac.bw', dept: 'CULH' },
      { id: 'u004', username: 'poneso', password: 'password', role: 'lecturer', name: 'Poneso Kgakge', changed: false, email: 'poneso@boswa.ac.bw', dept: 'CULP', code: '004' },
      { id: 'u005', username: 'nthoyapelo', password: 'password', role: 'lecturer', name: 'Nthoyapelo Senatla', changed: false, email: 'nthoyapelo@boswa.ac.bw', dept: 'CULP', code: '006' },
      { id: 'u006', username: 'sekgele', password: 'password', role: 'lecturer', name: 'Sekgele Mono', changed: false, email: 'sekgele@boswa.ac.bw', dept: 'CULP', code: '005' },
      { id: 'u007', username: 'neo', password: 'password', role: 'lecturer', name: 'Neo Medupe', changed: false, email: 'neo@boswa.ac.bw', dept: 'CULH', code: '008' },
      { id: 'u008', username: 'tshepang', password: 'password', role: 'lecturer', name: 'Tshepang Utlwang', changed: false, email: 'tshepang@boswa.ac.bw', dept: 'CULH', code: '007' },
    ],
    classes: [
      { id: 'cls001', name: 'Ramseys', programme: 'DIPL2025', year: 1, semester: 1, calYear: 2025, division: 'Year 1 - 2025', lecturer: 'Poneso Kgakge' },
      { id: 'cls002', name: 'Reubens', programme: 'DIPL2025', year: 1, semester: 1, calYear: 2025, division: 'Year 1 - 2025', lecturer: 'Nthoyapelo Senatla' },
      { id: 'cls003', name: 'Caremes', programme: 'DIPL2023', year: 3, semester: 1, calYear: 2026, division: 'Year 3 - 2023', lecturer: 'Sekgele Mono' },
      { id: 'cls004', name: 'Soyers', programme: 'DIPL2024', year: 2, semester: 1, calYear: 2026, division: 'Year 2 - 2024', lecturer: 'Neo Medupe' },
      { id: 'cls005', name: 'Escoffiers', programme: 'DIPL2024', year: 2, semester: 1, calYear: 2026, division: 'Year 2 - 2024', lecturer: 'Tshepang Utlwang' },
      { id: 'cls006', name: 'Cert Jan 2025', programme: 'CERT2025', year: 1, semester: 2, calYear: 2025, division: 'Year 1 - 2025', lecturer: 'Poneso Kgakge' },
      { id: 'cls007', name: 'Cert July 2025', programme: 'CERT2025', year: 1, semester: 1, calYear: 2025, division: 'Year 1 - 2025', lecturer: 'Sekgele Mono' },
    ],
    modules: [
      { id: 'mod001', code: 'BOSCG-01', name: 'Introduction to Hot Kitchen', dept: 'CULP', classes: ['cls001', 'cls002'] },
      { id: 'mod002', code: 'BOSCG-02', name: 'Cold Kitchen & Pastry', dept: 'CULP', classes: ['cls001', 'cls002'] },
      { id: 'mod003', code: 'BOSCG-03', name: 'Food Safety & Hygiene', dept: 'CULH', classes: ['cls001', 'cls002', 'cls003', 'cls004'] },
      { id: 'mod004', code: 'BOSCG-04', name: 'Professional Cookery', dept: 'CULP', classes: ['cls003', 'cls004', 'cls005'] },
      { id: 'mod005', code: 'BOSCG-05', name: 'Hospitality Management', dept: 'CULH', classes: ['cls004', 'cls005'] },
      { id: 'mod006', code: 'BOSCG-06', name: 'Culinary Arts Advanced', dept: 'CULP', classes: ['cls003'] },
      { id: 'mod007', code: 'BOSCG-07', name: 'Menu Planning', dept: 'CULH', classes: ['cls004', 'cls005'] },
      { id: 'mod008', code: 'BOSCG-08', name: 'Basic Culinary Skills', dept: 'CULP', classes: ['cls006', 'cls007'] },
    ],
    students: [
      { id: 's049', studentId: 'BCI2025D-49', name: 'Abigail T. Seoketsi', gender: 'Female', dob: '2006-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's050', studentId: 'BCI2025D-50', name: 'Ame T. Mothobi', gender: 'Female', dob: '2005-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's051', studentId: 'BCI2025D-51', name: 'Bokamoso Twala', gender: 'Female', dob: '2005-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's054', studentId: 'BCI2025D-54', name: 'Cornallius Monnane', gender: 'Male', dob: '2004-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's058', studentId: 'BCI2025D-58', name: 'Kaelo L. Mpotokwane', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's059', studentId: 'BCI2025D-59', name: 'Lesego J. Lesotlho', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's060', studentId: 'BCI2025D-60', name: 'Marang N. Keikabetse', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's061', studentId: 'BCI2025D-61', name: 'Mariam Hiyakozombo', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's064', studentId: 'BCI2025D-64', name: 'Pego Manthe', gender: 'Female', dob: '2005-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's065', studentId: 'BCI2025D-65', name: 'Precious K. Sakarea', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's067', studentId: 'BCI2025D-67', name: 'Ruth A. Fungwane', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls001', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's052', studentId: 'BCI2025D-52', name: 'Botlhe G. Nche', gender: 'Female', dob: '2005-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's053', studentId: 'BCI2025D-53', name: 'Changu Moloi', gender: 'Male', dob: '2004-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's055', studentId: 'BCI2025D-55', name: 'Ditlhapelo H. Gatang', gender: 'Male', dob: '2004-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's057', studentId: 'BCI2025D-57', name: 'Julia Letlhogile', gender: 'Female', dob: '2005-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's062', studentId: 'BCI2025D-62', name: 'Ogone Tseladikae', gender: 'Male', dob: '2004-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's063', studentId: 'BCI2025D-63', name: 'Onalenna Mokopane', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's066', studentId: 'BCI2025D-66', name: 'Rejoyce O. Kgomo', gender: 'Female', dob: '2005-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's068', studentId: 'BCI2025D-68', name: 'Thato G. Koogotsitse', gender: 'Female', dob: '2004-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's069', studentId: 'BCI2025D-69', name: 'Kabo Sengalo', gender: 'Male', dob: '2005-01-01', mobile: '', classId: 'cls002', guardian: '', programme: 'DIPL2025', year: 1, semester: 1, status: 'active' },
      { id: 's001', studentId: 'BCI2023D-01', name: 'Amogelang Chabaesele', gender: 'Female', dob: '2003-04-09', mobile: '75379140', classId: 'cls003', guardian: 'Malebogo Mojadife', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's002', studentId: 'BCI2023D-02', name: 'Yumna Arbi', gender: 'Female', dob: '2002-12-31', mobile: '77174402', classId: 'cls003', guardian: 'Merriam Rose Setswalo', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's003', studentId: 'BCI2023D-03', name: 'Thato Mabina', gender: 'Female', dob: '1997-09-02', mobile: '74291854', classId: 'cls003', guardian: 'Collin Mabina', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's004', studentId: 'BCI2023D-04', name: 'Marea Molaodi', gender: 'Female', dob: '2000-01-26', mobile: '76396468', classId: 'cls003', guardian: 'Oduetse Ditshoke', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's006', studentId: 'BCI2023D-06', name: 'Bogadi Motsoko', gender: 'Male', dob: '2002-05-05', mobile: '76363362', classId: 'cls003', guardian: 'Basinui Motsoko', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's007', studentId: 'BCI2023D-07', name: 'Loago Motlogelwa', gender: 'Male', dob: '2004-09-24', mobile: '76123362', classId: 'cls003', guardian: 'Kerataone Motlogelwa', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's008', studentId: 'BCI2023D-08', name: 'Katlo Puleng Ketlogetswe', gender: 'Female', dob: '2006-01-16', mobile: '77006063', classId: 'cls003', guardian: 'Kgomotso Ketlogetswe', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's009', studentId: 'BCI2023D-09', name: 'Dimpho Letlhoka', gender: 'Female', dob: '2004-06-17', mobile: '71708960', classId: 'cls003', guardian: 'Mma Mosa Moshoeshoe', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's010', studentId: 'BCI2023D-10', name: 'Larona Kelaotswe', gender: 'Female', dob: '2005-03-24', mobile: '71292740', classId: 'cls003', guardian: 'Yvonne Mading', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's011', studentId: 'BCI2023D-11', name: 'Hlompho Jobeta', gender: 'Female', dob: '2004-04-26', mobile: '76348262', classId: 'cls003', guardian: 'Botho Jobeta', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's012', studentId: 'BCI2023D-12', name: 'Babedi Ramosetheng', gender: 'Female', dob: '2001-03-18', mobile: '74656670', classId: 'cls003', guardian: 'Kilego Boikepetse', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's013', studentId: 'BCI2023D-13', name: 'Gaone Clifford Mafoko', gender: 'Male', dob: '2005-08-18', mobile: '77156829', classId: 'cls003', guardian: 'Kelebogile Mafoko', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's014', studentId: 'BCI2023D-14', name: 'Sona Molongwe', gender: 'Male', dob: '2005-08-09', mobile: '74129093', classId: 'cls003', guardian: 'Onneile Molongwe', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's015', studentId: 'BCI2023D-15', name: 'Goabaone Tshosa', gender: 'Female', dob: '2004-03-26', mobile: '78036912', classId: 'cls003', guardian: 'Moses Tshosa', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's017', studentId: 'BCI2023D-17', name: 'Seipato Ramosetheng', gender: 'Female', dob: '2004-09-30', mobile: '75993792', classId: 'cls003', guardian: 'Kilego Boikepetse', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's020', studentId: 'BCI2023D-20', name: 'Lefika Macheng', gender: 'Male', dob: '2002-11-29', mobile: '75994106', classId: 'cls003', guardian: 'Omphile Macheng', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's021', studentId: 'BCI2023D-21', name: 'Bone Masilonyane', gender: 'Male', dob: '1995-01-24', mobile: '72244866', classId: 'cls003', guardian: 'Motho Masilonyane', programme: 'DIPL2023', year: 3, semester: 1, status: 'active' },
      { id: 's023', studentId: 'BCI2024D-23', name: 'Keamogetse P. Dintwe', gender: 'Female', dob: '2005-12-28', mobile: '72553773', classId: 'cls004', guardian: 'Odirile Lydia Dintwe', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's027', studentId: 'BCI2024D-27', name: 'Olorato Pearl Kedisitse', gender: 'Female', dob: '2004-10-23', mobile: '77564548', classId: 'cls004', guardian: 'Nametso Kedisitse', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's028', studentId: 'BCI2024D-28', name: 'Katlego Ketlhoafetse', gender: 'Female', dob: '2004-11-19', mobile: '72222292', classId: 'cls004', guardian: 'Samuel Ketlhoafetse', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's032', studentId: 'BCI2024D-32', name: 'Gomolemo J.K. Maenge', gender: 'Female', dob: '2000-01-26', mobile: '72162767', classId: 'cls004', guardian: 'Maenge Maenge', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's033', studentId: 'BCI2024D-33', name: 'Neelo Lily Mooketsane', gender: 'Female', dob: '2001-01-01', mobile: '76518626', classId: 'cls004', guardian: 'Modula Mooketsane', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's035', studentId: 'BCI2024D-35', name: 'Nthabiseng Pinky Mosele', gender: 'Female', dob: '2003-08-10', mobile: '74320070', classId: 'cls004', guardian: 'Lizzy Mosele', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's036', studentId: 'BCI2024D-36', name: 'Kian Maatla Ndlovu', gender: 'Male', dob: '2005-12-08', mobile: '7254999', classId: 'cls004', guardian: 'Tumediso Ndlovu', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's030', studentId: 'BCI2024D-30', name: 'Theo Popo Lebogang', gender: 'Male', dob: '2003-01-01', mobile: '', classId: 'cls005', guardian: '', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's034', studentId: 'BCI2024D-34', name: 'Baboloki Molapong', gender: 'Female', dob: '2003-01-01', mobile: '', classId: 'cls005', guardian: '', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
      { id: 's037', studentId: 'BCI2024D-37', name: 'Koziba Naomi Pelaelo', gender: 'Female', dob: '2003-01-01', mobile: '', classId: 'cls005', guardian: '', programme: 'DIPL2024', year: 2, semester: 1, status: 'active' },
    ],
    marks: [
      { studentId: 'BCI2025D-49', moduleId: 'mod001', classId: 'cls001', test1: 82, test2: 93, practTest: 87, indAss: 67, grpAss: 60, finalExam: 79, practical: 85, year: 1, semester: 1 },
      { studentId: 'BCI2025D-50', moduleId: 'mod001', classId: 'cls001', test1: 90, test2: 95, practTest: 78, indAss: 80, grpAss: 60, finalExam: 95, practical: 90, year: 1, semester: 1 },
      { studentId: 'BCI2025D-51', moduleId: 'mod001', classId: 'cls001', test1: 74, test2: 90, practTest: 69, indAss: 89, grpAss: 64, finalExam: 68, practical: 78, year: 1, semester: 1 },
      { studentId: 'BCI2025D-54', moduleId: 'mod001', classId: 'cls001', test1: 72, test2: 68, practTest: 74, indAss: 79, grpAss: 60, finalExam: 70, practical: 80, year: 1, semester: 1 },
      { studentId: 'BCI2025D-58', moduleId: 'mod001', classId: 'cls001', test1: 57, test2: 60, practTest: 82, indAss: 88, grpAss: 62, finalExam: 69, practical: 78, year: 1, semester: 1 },
      { studentId: 'BCI2025D-59', moduleId: 'mod001', classId: 'cls001', test1: 90, test2: 80, practTest: 81, indAss: 78, grpAss: 60, finalExam: 74, practical: 85, year: 1, semester: 1 },
      { studentId: 'BCI2025D-60', moduleId: 'mod001', classId: 'cls001', test1: 80, test2: 73, practTest: 89, indAss: 74, grpAss: 64, finalExam: 89, practical: 88, year: 1, semester: 1 },
      { studentId: 'BCI2025D-61', moduleId: 'mod001', classId: 'cls001', test1: 64, test2: 64, practTest: 83, indAss: 71, grpAss: 64, finalExam: 88, practical: 82, year: 1, semester: 1 },
      { studentId: 'BCI2025D-64', moduleId: 'mod001', classId: 'cls001', test1: 71, test2: 70, practTest: 90, indAss: 72, grpAss: 70, finalExam: 91, practical: 88, year: 1, semester: 1 },
      { studentId: 'BCI2025D-65', moduleId: 'mod001', classId: 'cls001', test1: 73, test2: 63, practTest: 68, indAss: 74, grpAss: 70, finalExam: 95, practical: 90, year: 1, semester: 1 },
      { studentId: 'BCI2025D-67', moduleId: 'mod001', classId: 'cls001', test1: 57, test2: 60, practTest: 82, indAss: 88, grpAss: 62, finalExam: 69, practical: 75, year: 1, semester: 1 },
      { studentId: 'BCI2025D-52', moduleId: 'mod001', classId: 'cls002', test1: 88, test2: 100, practTest: 85, indAss: 86, grpAss: 60, finalExam: 96, practical: 92, year: 1, semester: 1 },
      { studentId: 'BCI2025D-53', moduleId: 'mod001', classId: 'cls002', test1: 96, test2: 95, practTest: 85, indAss: 87, grpAss: 70, finalExam: 88, practical: 90, year: 1, semester: 1 },
      { studentId: 'BCI2025D-55', moduleId: 'mod001', classId: 'cls002', test1: 78, test2: 53, practTest: 81, indAss: 72, grpAss: 60, finalExam: 75, practical: 82, year: 1, semester: 1 },
      { studentId: 'BCI2025D-57', moduleId: 'mod001', classId: 'cls002', test1: 60, test2: 78, practTest: 77, indAss: 72, grpAss: 60, finalExam: 79, practical: 78, year: 1, semester: 1 },
      { studentId: 'BCI2025D-62', moduleId: 'mod001', classId: 'cls002', test1: 50, test2: 56, practTest: 87, indAss: 71, grpAss: 62, finalExam: 70, practical: 72, year: 1, semester: 1 },
      { studentId: 'BCI2025D-63', moduleId: 'mod001', classId: 'cls002', test1: 83, test2: 64, practTest: 83, indAss: 74, grpAss: 60, finalExam: 95, practical: 88, year: 1, semester: 1 },
      { studentId: 'BCI2025D-66', moduleId: 'mod001', classId: 'cls002', test1: 80, test2: 80, practTest: 87, indAss: 74, grpAss: 60, finalExam: 92, practical: 85, year: 1, semester: 1 },
      { studentId: 'BCI2025D-68', moduleId: 'mod001', classId: 'cls002', test1: 83, test2: 73, practTest: 85, indAss: 73, grpAss: 62, finalExam: 83, practical: 80, year: 1, semester: 1 },
      { studentId: 'BCI2025D-69', moduleId: 'mod001', classId: 'cls002', test1: 60, test2: 0, practTest: 0, indAss: 0, grpAss: 0, finalExam: 0, practical: 0, year: 1, semester: 1 },
    ],
    attendance: [],
    studentModules: [],
    exams: [
      { id: 'ex001', name: 'Mid-Term Exam 2025 S1', moduleId: 'mod001', classId: 'cls001', date: '2025-10-15', status: 'done', type: 'Written Exam' },
      { id: 'ex002', name: 'Final Exam 2025 S1', moduleId: 'mod001', classId: 'cls001', date: '2025-12-10', status: 'done', type: 'Final Exam' },
      { id: 'ex003', name: 'Mid-Term Exam 2026 S1', moduleId: 'mod003', classId: 'cls003', date: '2026-04-15', status: 'confirmed', type: 'Written Exam' },
      { id: 'ex004', name: 'Final Exam 2026 S1', moduleId: 'mod003', classId: 'cls004', date: '2026-06-20', status: 'draft', type: 'Final Exam' },
    ],
    assignments: [
      { id: 'as001', title: 'Individual Recipe Assignment', moduleId: 'mod001', classId: 'cls001', dueDate: '2025-09-30', marks: 20, status: 'graded', description: 'Prepare a detailed recipe card for a dish of your choice.', instructions: 'Submit as a single PDF. Maximum 5 pages.', attachmentName: 'Recipe_Assignment_Brief.pdf', attachmentData: null, uploadedBy: 'Kefiloe Phiri', uploadedDate: '2025-09-01' },
      { id: 'as002', title: 'Group Assignment - Menu Planning', moduleId: 'mod001', classId: 'cls001', dueDate: '2025-10-20', marks: 20, status: 'graded', description: 'In groups of 4, design a 3-course dinner menu.', instructions: 'Submit one PDF per group.', attachmentName: 'Menu_Planning_Guide.pdf', attachmentData: null, uploadedBy: 'Kefiloe Phiri', uploadedDate: '2025-10-01' },
      { id: 'as003', title: 'Food Safety & HACCP Report', moduleId: 'mod003', classId: 'cls003', dueDate: '2026-04-10', marks: 30, status: 'active', description: 'Write a detailed report on HACCP principles.', instructions: 'Academic report format. APA referencing. Minimum 5 sources.', attachmentName: 'HACCP_Report_Guidelines.pdf', attachmentData: null, uploadedBy: 'Mpho Tshwane', uploadedDate: '2026-03-01' },
      { id: 'as004', title: 'Kitchen Equipment Maintenance Log', moduleId: 'mod002', classId: 'cls002', dueDate: '2026-04-20', marks: 25, status: 'active', description: 'Document a 2-week daily maintenance log.', instructions: 'Use the provided log template. Individual assignment.', attachmentName: 'Maintenance_Log_Template.pdf', attachmentData: null, uploadedBy: 'Boitumelo Kgosi', uploadedDate: '2026-03-15' },
    ],
    submissions: [
      { id: 'sub001', assignmentId: 'as001', studentId: 'STU001', submittedDate: '2025-09-28', submittedTime: '14:32', fileName: 'STU001_Modise_Recipe.pdf', fileSize: '245 KB', notes: 'Traditional Setswana dish.', status: 'graded', grade: 17, feedback: 'Excellent presentation.' },
      { id: 'sub002', assignmentId: 'as002', studentId: 'STU001', submittedDate: '2025-10-18', submittedTime: '09:15', fileName: 'Group4_MenuPlan_Final.pdf', fileSize: '1.2 MB', notes: 'Group 4 submission.', status: 'graded', grade: 18, feedback: 'Creative menu design.' },
    ],
    timetable: [
      { id: 'tt001', classId: 'cls001', day: 'Monday', time: '08:00-10:00', moduleId: 'mod001', room: 'Kitchen 1' },
      { id: 'tt002', classId: 'cls001', day: 'Monday', time: '10:00-12:00', moduleId: 'mod002', room: 'Kitchen 1' },
      { id: 'tt003', classId: 'cls001', day: 'Tuesday', time: '08:00-11:00', moduleId: 'mod003', room: 'Lecture Room A' },
      { id: 'tt004', classId: 'cls002', day: 'Wednesday', time: '08:00-10:00', moduleId: 'mod001', room: 'Kitchen 2' },
      { id: 'tt005', classId: 'cls003', day: 'Thursday', time: '08:00-11:00', moduleId: 'mod004', room: 'Kitchen 1' },
      { id: 'tt006', classId: 'cls003', day: 'Friday', time: '08:00-10:00', moduleId: 'mod006', room: 'Kitchen 3' },
      { id: 'tt007', classId: 'cls004', day: 'Monday', time: '13:00-16:00', moduleId: 'mod005', room: 'Lecture Room B' },
    ],
    notifications: [
      { id: 'n1', title: 'Term 1 2026 Commencement', body: 'All students must report to their respective classes by 7 July 2025. Registration deadline is 30 June 2025.', date: '2026-01-15', priority: 'high', author: 'Admin' },
      { id: 'n2', title: 'Practical Exam Schedule Released', body: 'The practical examination timetable for Semester 1 has been released. Please check with your class lecturer.', date: '2026-02-01', priority: 'normal', author: 'Admin' },
      { id: 'n3', title: 'Library Hours Extended', body: 'The library will now be open from 7am to 8pm Monday to Friday during examination period.', date: '2026-02-20', priority: 'low', author: 'Admin' },
    ],
    admissionEnquiries: [
      { id: 'ae001', name: 'Thabo Mokgosi', programme: 'Diploma in Culinary Arts', status: 'pending', date: '2026-02-28' },
    ],
  };

  // Seed attendance
  const days = ['2026-02-20', '2026-02-21', '2026-02-25', '2026-02-26', '2026-02-27'];
  days.forEach(date => {
    db.students.slice(0, 10).forEach(s => {
      const r = Math.random();
      db.attendance.push({ studentId: s.studentId, classId: s.classId, date, status: r < 0.85 ? 'present' : r < 0.93 ? 'absent' : 'late' });
    });
  });

  return db;
}

export function calcModuleMark(m: Mark): number {
  const cw = ((m.test1 + m.test2 + m.practTest + m.indAss + m.grpAss) / 5) * 0.4;
  const fm = m.finalExam * 0.4;
  const pm = m.practical * 0.2;
  return Math.round(cw + fm + pm);
}

export function grade(pct: number): string {
  if (pct < 50) return 'Fail';
  if (pct < 60) return 'Pass';
  if (pct < 70) return 'Credit';
  if (pct < 80) return 'Merit';
  return 'Distinction';
}

export function gradeColor(g: string): string {
  const m: Record<string, string> = { Fail: 'badge-fail', Pass: 'badge-pass', Credit: 'badge-credit', Merit: 'badge-merit', Distinction: 'badge-distinction' };
  return m[g] || 'badge-inactive';
}

export const roleCredentials: Record<string, { username: string; password: string }> = {
  admin: { username: 'admin', password: 'password' },
  hod: { username: 'bonang', password: 'password' },
  hoy: { username: 'malcom', password: 'password' },
  lecturer: { username: 'poneso', password: 'password' },
  student: { username: 'abigail', password: 'password' },
};
