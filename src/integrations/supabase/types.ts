export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admission_enquiries: {
        Row: {
          date: string | null
          dob: string | null
          gender: string | null
          id: string
          mobile: string | null
          name: string
          programme: string | null
          status: string | null
        }
        Insert: {
          date?: string | null
          dob?: string | null
          gender?: string | null
          id: string
          mobile?: string | null
          name: string
          programme?: string | null
          status?: string | null
        }
        Update: {
          date?: string | null
          dob?: string | null
          gender?: string | null
          id?: string
          mobile?: string | null
          name?: string
          programme?: string | null
          status?: string | null
        }
        Relationships: []
      }
      advance_salaries: {
        Row: {
          created_at: string | null
          current_stage: string | null
          employee_id: string | null
          id: string
          installments: number
          loan_type: string | null
          monthly_installment: number
          notes: string | null
          reference: string
          rejection_reason: string | null
          remaining_amount: number | null
          request_date: string
          required_stages: string[] | null
          status: string | null
          total_amount: number
        }
        Insert: {
          created_at?: string | null
          current_stage?: string | null
          employee_id?: string | null
          id?: string
          installments: number
          loan_type?: string | null
          monthly_installment: number
          notes?: string | null
          reference: string
          rejection_reason?: string | null
          remaining_amount?: number | null
          request_date?: string
          required_stages?: string[] | null
          status?: string | null
          total_amount: number
        }
        Update: {
          created_at?: string | null
          current_stage?: string | null
          employee_id?: string | null
          id?: string
          installments?: number
          loan_type?: string | null
          monthly_installment?: number
          notes?: string | null
          reference?: string
          rejection_reason?: string | null
          remaining_amount?: number | null
          request_date?: string
          required_stages?: string[] | null
          status?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "advance_salaries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      applicants: {
        Row: {
          created_at: string | null
          dob: string | null
          email: string | null
          gender: string | null
          guardian_email: string | null
          guardian_mobile: string | null
          guardian_name: string | null
          id: string
          id_document_url: string | null
          mobile: string | null
          name: string | null
          national_id: string | null
          nationality: string | null
          qualification_url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          dob?: string | null
          email?: string | null
          gender?: string | null
          guardian_email?: string | null
          guardian_mobile?: string | null
          guardian_name?: string | null
          id: string
          id_document_url?: string | null
          mobile?: string | null
          name?: string | null
          national_id?: string | null
          nationality?: string | null
          qualification_url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          dob?: string | null
          email?: string | null
          gender?: string | null
          guardian_email?: string | null
          guardian_mobile?: string | null
          guardian_name?: string | null
          id?: string
          id_document_url?: string | null
          mobile?: string | null
          name?: string | null
          national_id?: string | null
          nationality?: string | null
          qualification_url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      applications: {
        Row: {
          applicant_id: string | null
          decided_at: string | null
          enrolled_at: string | null
          first_choice_programme: string | null
          id: string
          intake_month: number | null
          rejection_reason: string | null
          reviewed_at: string | null
          second_choice_programme: string | null
          sponsor_doc_url: string | null
          sponsor_name: string | null
          sponsor_type: string | null
          status: string | null
          submitted_at: string | null
        }
        Insert: {
          applicant_id?: string | null
          decided_at?: string | null
          enrolled_at?: string | null
          first_choice_programme?: string | null
          id: string
          intake_month?: number | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          second_choice_programme?: string | null
          sponsor_doc_url?: string | null
          sponsor_name?: string | null
          sponsor_type?: string | null
          status?: string | null
          submitted_at?: string | null
        }
        Update: {
          applicant_id?: string | null
          decided_at?: string | null
          enrolled_at?: string | null
          first_choice_programme?: string | null
          id?: string
          intake_month?: number | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          second_choice_programme?: string | null
          sponsor_doc_url?: string | null
          sponsor_name?: string | null
          sponsor_type?: string | null
          status?: string | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "applicants"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_marks: {
        Row: {
          assessment_id: string
          assessment_type: string
          class_id: string | null
          created_at: string | null
          id: string
          module_id: string | null
          score: number
          student_id: string
        }
        Insert: {
          assessment_id: string
          assessment_type: string
          class_id?: string | null
          created_at?: string | null
          id: string
          module_id?: string | null
          score?: number
          student_id: string
        }
        Update: {
          assessment_id?: string
          assessment_type?: string
          class_id?: string | null
          created_at?: string | null
          id?: string
          module_id?: string | null
          score?: number
          student_id?: string
        }
        Relationships: []
      }
      assignments: {
        Row: {
          attachment_data: string | null
          attachment_name: string | null
          class_id: string | null
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          instructions: string | null
          marks: number | null
          module_id: string | null
          status: string | null
          submission_type: string | null
          title: string
          uploaded_by: string | null
          uploaded_date: string | null
        }
        Insert: {
          attachment_data?: string | null
          attachment_name?: string | null
          class_id?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id: string
          instructions?: string | null
          marks?: number | null
          module_id?: string | null
          status?: string | null
          submission_type?: string | null
          title: string
          uploaded_by?: string | null
          uploaded_date?: string | null
        }
        Update: {
          attachment_data?: string | null
          attachment_name?: string | null
          class_id?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          instructions?: string | null
          marks?: number | null
          module_id?: string | null
          status?: string | null
          submission_type?: string | null
          title?: string
          uploaded_by?: string | null
          uploaded_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          class_id: string
          date: string
          id: string
          module_id: string | null
          status: string
          student_id: string
        }
        Insert: {
          class_id: string
          date: string
          id?: string
          module_id?: string | null
          status?: string
          student_id: string
        }
        Update: {
          class_id?: string
          date?: string
          id?: string
          module_id?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_devices: {
        Row: {
          api_key: string | null
          device_ip: string | null
          device_name: string | null
          device_password: string | null
          device_port: number | null
          device_serial: string
          device_user: string | null
          first_seen: string | null
          id: number
          is_active: boolean
          last_seen: string | null
          last_sync: string | null
          location: string | null
        }
        Insert: {
          api_key?: string | null
          device_ip?: string | null
          device_name?: string | null
          device_password?: string | null
          device_port?: number | null
          device_serial: string
          device_user?: string | null
          first_seen?: string | null
          id?: number
          is_active?: boolean
          last_seen?: string | null
          last_sync?: string | null
          location?: string | null
        }
        Update: {
          api_key?: string | null
          device_ip?: string | null
          device_name?: string | null
          device_password?: string | null
          device_port?: number | null
          device_serial?: string
          device_user?: string | null
          first_seen?: string | null
          id?: number
          is_active?: boolean
          last_seen?: string | null
          last_sync?: string | null
          location?: string | null
        }
        Relationships: []
      }
      attendance_records: {
        Row: {
          data_source: string | null
          department: string | null
          device_name: string | null
          device_serial: string
          employee_id: string
          first_name: string | null
          full_name: string | null
          id: number
          imported_at: string | null
          last_name: string | null
          punch_at: string
          punch_date: string
          punch_state: string | null
          punch_time: string
          raw_row: Json | null
          weekday: string | null
        }
        Insert: {
          data_source?: string | null
          department?: string | null
          device_name?: string | null
          device_serial: string
          employee_id: string
          first_name?: string | null
          full_name?: string | null
          id?: number
          imported_at?: string | null
          last_name?: string | null
          punch_at: string
          punch_date: string
          punch_state?: string | null
          punch_time: string
          raw_row?: Json | null
          weekday?: string | null
        }
        Update: {
          data_source?: string | null
          department?: string | null
          device_name?: string | null
          device_serial?: string
          employee_id?: string
          first_name?: string | null
          full_name?: string | null
          id?: number
          imported_at?: string | null
          last_name?: string | null
          punch_at?: string
          punch_date?: string
          punch_state?: string | null
          punch_time?: string
          raw_row?: Json | null
          weekday?: string | null
        }
        Relationships: []
      }
      attendance_settings: {
        Row: {
          grace_period_minutes: number
          id: number
          saturday_enabled: boolean
          saturday_grace_minutes: number | null
          saturday_work_start_time: string | null
          updated_at: string
          work_start_time: string
        }
        Insert: {
          grace_period_minutes?: number
          id?: number
          saturday_enabled?: boolean
          saturday_grace_minutes?: number | null
          saturday_work_start_time?: string | null
          updated_at?: string
          work_start_time?: string
        }
        Update: {
          grace_period_minutes?: number
          id?: number
          saturday_enabled?: boolean
          saturday_grace_minutes?: number | null
          saturday_work_start_time?: string | null
          updated_at?: string
          work_start_time?: string
        }
        Relationships: []
      }
      classes: {
        Row: {
          cal_year: number
          division: string | null
          id: string
          lecturer: string | null
          name: string
          programme: string | null
          semester: number
          year: number
        }
        Insert: {
          cal_year: number
          division?: string | null
          id: string
          lecturer?: string | null
          name: string
          programme?: string | null
          semester: number
          year: number
        }
        Update: {
          cal_year?: number
          division?: string | null
          id?: string
          lecturer?: string | null
          name?: string
          programme?: string | null
          semester?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "classes_programme_fkey"
            columns: ["programme"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      contract_lines: {
        Row: {
          amount: number | null
          component_def_id: string | null
          contract_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_earning: boolean
          sequence: number | null
        }
        Insert: {
          amount?: number | null
          component_def_id?: string | null
          contract_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_earning?: boolean
          sequence?: number | null
        }
        Update: {
          amount?: number | null
          component_def_id?: string | null
          contract_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_earning?: boolean
          sequence?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_lines_component_def_id_fkey"
            columns: ["component_def_id"]
            isOneToOne: false
            referencedRelation: "pay_component_defs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_lines_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_template_lines: {
        Row: {
          component_def_id: string | null
          created_at: string | null
          default_amount: number | null
          id: string
          sequence: number | null
          template_id: string
        }
        Insert: {
          component_def_id?: string | null
          created_at?: string | null
          default_amount?: number | null
          id?: string
          sequence?: number | null
          template_id: string
        }
        Update: {
          component_def_id?: string | null
          created_at?: string | null
          default_amount?: number | null
          id?: string
          sequence?: number | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_template_lines_component_def_id_fkey"
            columns: ["component_def_id"]
            isOneToOne: false
            referencedRelation: "pay_component_defs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          advance_deduction: number | null
          bank_loan: number | null
          car_insurance: number | null
          contract_name: string | null
          created_at: string | null
          department: string | null
          employee_id: string | null
          end_date: string | null
          funeral_cover: number | null
          id: string
          job_position: string | null
          medical_aid: number | null
          other_deduction: number | null
          other_loan: number | null
          rent: number | null
          salary_structure_type: string | null
          staff_loan: number | null
          start_date: string | null
          status: string | null
          template_id: string | null
          updated_at: string | null
          wage: number
        }
        Insert: {
          advance_deduction?: number | null
          bank_loan?: number | null
          car_insurance?: number | null
          contract_name?: string | null
          created_at?: string | null
          department?: string | null
          employee_id?: string | null
          end_date?: string | null
          funeral_cover?: number | null
          id?: string
          job_position?: string | null
          medical_aid?: number | null
          other_deduction?: number | null
          other_loan?: number | null
          rent?: number | null
          salary_structure_type?: string | null
          staff_loan?: number | null
          start_date?: string | null
          status?: string | null
          template_id?: string | null
          updated_at?: string | null
          wage?: number
        }
        Update: {
          advance_deduction?: number | null
          bank_loan?: number | null
          car_insurance?: number | null
          contract_name?: string | null
          created_at?: string | null
          department?: string | null
          employee_id?: string | null
          end_date?: string | null
          funeral_cover?: number | null
          id?: string
          job_position?: string | null
          medical_aid?: number | null
          other_deduction?: number | null
          other_loan?: number | null
          rent?: number | null
          salary_structure_type?: string | null
          staff_loan?: number | null
          start_date?: string | null
          status?: string | null
          template_id?: string | null
          updated_at?: string | null
          wage?: number
        }
        Relationships: [
          {
            foreignKeyName: "contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          hod: string | null
          id: string
          name: string
        }
        Insert: {
          hod?: string | null
          id: string
          name: string
        }
        Update: {
          hod?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      document_settings: {
        Row: {
          alert_30_days: boolean | null
          alert_7_days: boolean | null
          alert_on_expiry: boolean | null
          created_at: string | null
          document_type: string
          id: string
          is_required: boolean | null
        }
        Insert: {
          alert_30_days?: boolean | null
          alert_7_days?: boolean | null
          alert_on_expiry?: boolean | null
          created_at?: string | null
          document_type: string
          id?: string
          is_required?: boolean | null
        }
        Update: {
          alert_30_days?: boolean | null
          alert_7_days?: boolean | null
          alert_on_expiry?: boolean | null
          created_at?: string | null
          document_type?: string
          id?: string
          is_required?: boolean | null
        }
        Relationships: []
      }
      document_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      employee_documents: {
        Row: {
          alert_sent_30: boolean
          alert_sent_7: boolean
          document_name: string | null
          document_type: string
          document_type_id: string | null
          employee_id: string | null
          expiry_date: string | null
          file_path: string | null
          file_size: number | null
          id: string
          is_active: boolean
          issue_date: string | null
          mime_type: string | null
          notes: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          alert_sent_30?: boolean
          alert_sent_7?: boolean
          document_name?: string | null
          document_type: string
          document_type_id?: string | null
          employee_id?: string | null
          expiry_date?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          is_active?: boolean
          issue_date?: string | null
          mime_type?: string | null
          notes?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          alert_sent_30?: boolean
          alert_sent_7?: boolean
          document_name?: string | null
          document_type?: string
          document_type_id?: string | null
          employee_id?: string | null
          expiry_date?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          is_active?: boolean
          issue_date?: string | null
          mime_type?: string | null
          notes?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_group_members: {
        Row: {
          created_at: string
          employee_id: string
          group_id: string
          id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          group_id: string
          id?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_group_members_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "employee_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_groups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      employee_leave_balances: {
        Row: {
          annual_leave: number
          employee_id: string
          id: string
          sick_leave: number
          updated_at: string
          year: number
        }
        Insert: {
          annual_leave?: number
          employee_id: string
          id?: string
          sick_leave?: number
          updated_at?: string
          year?: number
        }
        Update: {
          annual_leave?: number
          employee_id?: string
          id?: string
          sick_leave?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_pay_components: {
        Row: {
          amount: number | null
          component_def_id: string | null
          created_at: string | null
          employee_id: string | null
          hours: number | null
          id: string
          is_active: boolean | null
        }
        Insert: {
          amount?: number | null
          component_def_id?: string | null
          created_at?: string | null
          employee_id?: string | null
          hours?: number | null
          id?: string
          is_active?: boolean | null
        }
        Update: {
          amount?: number | null
          component_def_id?: string | null
          created_at?: string | null
          employee_id?: string | null
          hours?: number | null
          id?: string
          is_active?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_pay_components_component_def_id_fkey"
            columns: ["component_def_id"]
            isOneToOne: false
            referencedRelation: "pay_component_defs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_pay_components_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          account_no: string | null
          auth_user_id: string | null
          bank_branch_code: string | null
          bank_branch_name: string | null
          bank_name: string | null
          basic_salary: number | null
          biometric_id: string | null
          branch_name: string | null
          created_at: string
          department: string | null
          email: string | null
          employee_code: string
          employee_name: string
          gender: string | null
          hr_department_id: string | null
          id: string
          job_title: string | null
          joining_date: string | null
          manager_id: string | null
          mobile_number: string | null
          payslip_date: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          account_no?: string | null
          auth_user_id?: string | null
          bank_branch_code?: string | null
          bank_branch_name?: string | null
          bank_name?: string | null
          basic_salary?: number | null
          biometric_id?: string | null
          branch_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          employee_code: string
          employee_name: string
          gender?: string | null
          hr_department_id?: string | null
          id?: string
          job_title?: string | null
          joining_date?: string | null
          manager_id?: string | null
          mobile_number?: string | null
          payslip_date?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          account_no?: string | null
          auth_user_id?: string | null
          bank_branch_code?: string | null
          bank_branch_name?: string | null
          bank_name?: string | null
          basic_salary?: number | null
          biometric_id?: string | null
          branch_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          employee_code?: string
          employee_name?: string
          gender?: string | null
          hr_department_id?: string | null
          id?: string
          job_title?: string | null
          joining_date?: string | null
          manager_id?: string | null
          mobile_number?: string | null
          payslip_date?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_hr_department_id_fkey"
            columns: ["hr_department_id"]
            isOneToOne: false
            referencedRelation: "hr_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          class_id: string | null
          created_by: string | null
          date: string | null
          end_time: string | null
          id: string
          module_id: string | null
          name: string
          room: string | null
          start_time: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          class_id?: string | null
          created_by?: string | null
          date?: string | null
          end_time?: string | null
          id: string
          module_id?: string | null
          name: string
          room?: string | null
          start_time?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          class_id?: string | null
          created_by?: string | null
          date?: string | null
          end_time?: string | null
          id?: string
          module_id?: string | null
          name?: string
          room?: string | null
          start_time?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_attendance: {
        Row: {
          attendance_date: string
          check_in: string | null
          check_out: string | null
          created_at: string | null
          employee_id: string | null
          hours_worked: number | null
          id: string
          notes: string | null
          status: string | null
        }
        Insert: {
          attendance_date: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          hours_worked?: number | null
          id?: string
          notes?: string | null
          status?: string | null
        }
        Update: {
          attendance_date?: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          hours_worked?: number | null
          id?: string
          notes?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_departments: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          manager: string | null
          name: string
          parent_department: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manager?: string | null
          name: string
          parent_department?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manager?: string | null
          name?: string
          parent_department?: string | null
        }
        Relationships: []
      }
      hr_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          read_at: string | null
          related_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          read_at?: string | null
          related_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          read_at?: string | null
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      impersonation_sessions: {
        Row: {
          admin_user_id: string
          ended_at: string | null
          expires_at: string
          id: string
          note: string | null
          started_at: string
          target_user_id: string
        }
        Insert: {
          admin_user_id: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          note?: string | null
          started_at?: string
          target_user_id: string
        }
        Update: {
          admin_user_id?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          note?: string | null
          started_at?: string
          target_user_id?: string
        }
        Relationships: []
      }
      leave_allocations: {
        Row: {
          allocated_days: number | null
          carried_forward_days: number | null
          created_at: string | null
          employee_id: string | null
          id: string
          leave_type_id: string | null
          opening_balance: number
          pending_days: number
          remaining_days: number | null
          updated_at: string | null
          used_days: number | null
          year: number | null
        }
        Insert: {
          allocated_days?: number | null
          carried_forward_days?: number | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          leave_type_id?: string | null
          opening_balance?: number
          pending_days?: number
          remaining_days?: number | null
          updated_at?: string | null
          used_days?: number | null
          year?: number | null
        }
        Update: {
          allocated_days?: number | null
          carried_forward_days?: number | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          leave_type_id?: string | null
          opening_balance?: number
          pending_days?: number
          remaining_days?: number | null
          updated_at?: string | null
          used_days?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_allocations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_allocations_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          admin_notes: string | null
          applied_date: string | null
          approved_at: string | null
          approved_by: string | null
          approved_date: string | null
          approver_comment: string | null
          certificate_filename: string | null
          certificate_url: string | null
          created_at: string | null
          current_stage: string | null
          employee_id: string | null
          end_date: string
          handover_notes: string | null
          id: string
          leave_ref: string | null
          leave_type_id: string | null
          num_days: number | null
          number_of_days: number
          reason: string | null
          rejection_reason: string | null
          required_stages: string[] | null
          start_date: string
          status: string | null
        }
        Insert: {
          admin_notes?: string | null
          applied_date?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_date?: string | null
          approver_comment?: string | null
          certificate_filename?: string | null
          certificate_url?: string | null
          created_at?: string | null
          current_stage?: string | null
          employee_id?: string | null
          end_date: string
          handover_notes?: string | null
          id?: string
          leave_ref?: string | null
          leave_type_id?: string | null
          num_days?: number | null
          number_of_days: number
          reason?: string | null
          rejection_reason?: string | null
          required_stages?: string[] | null
          start_date: string
          status?: string | null
        }
        Update: {
          admin_notes?: string | null
          applied_date?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_date?: string | null
          approver_comment?: string | null
          certificate_filename?: string | null
          certificate_url?: string | null
          created_at?: string | null
          current_stage?: string | null
          employee_id?: string | null
          end_date?: string
          handover_notes?: string | null
          id?: string
          leave_ref?: string | null
          leave_type_id?: string | null
          num_days?: number | null
          number_of_days?: number
          reason?: string | null
          rejection_reason?: string | null
          required_stages?: string[] | null
          start_date?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          carry_forward: boolean | null
          code: string | null
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_paid: boolean | null
          max_carry_forward_days: number | null
          max_consecutive_days: number | null
          max_days: number | null
          min_days_notice: number | null
          name: string
          requires_approval: boolean | null
          requires_certificate: boolean | null
        }
        Insert: {
          carry_forward?: boolean | null
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          max_carry_forward_days?: number | null
          max_consecutive_days?: number | null
          max_days?: number | null
          min_days_notice?: number | null
          name: string
          requires_approval?: boolean | null
          requires_certificate?: boolean | null
        }
        Update: {
          carry_forward?: boolean | null
          code?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          max_carry_forward_days?: number | null
          max_consecutive_days?: number | null
          max_days?: number | null
          min_days_notice?: number | null
          name?: string
          requires_approval?: boolean | null
          requires_certificate?: boolean | null
        }
        Relationships: []
      }
      lecturer_modules: {
        Row: {
          class_id: string
          created_at: string | null
          id: string
          lecturer_id: string
          module_id: string
        }
        Insert: {
          class_id: string
          created_at?: string | null
          id: string
          lecturer_id: string
          module_id: string
        }
        Update: {
          class_id?: string
          created_at?: string | null
          id?: string
          lecturer_id?: string
          module_id?: string
        }
        Relationships: []
      }
      loan_types: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      marks: {
        Row: {
          class_id: string
          final_exam: number | null
          grp_ass: number | null
          id: string
          ind_ass: number | null
          module_id: string
          pract_test: number | null
          practical: number | null
          semester: number
          student_id: string
          test1: number | null
          test2: number | null
          year: number
        }
        Insert: {
          class_id: string
          final_exam?: number | null
          grp_ass?: number | null
          id?: string
          ind_ass?: number | null
          module_id: string
          pract_test?: number | null
          practical?: number | null
          semester: number
          student_id: string
          test1?: number | null
          test2?: number | null
          year: number
        }
        Update: {
          class_id?: string
          final_exam?: number | null
          grp_ass?: number | null
          id?: string
          ind_ass?: number | null
          module_id?: string
          pract_test?: number | null
          practical?: number | null
          semester?: number
          student_id?: string
          test1?: number | null
          test2?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "marks_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      module_classes: {
        Row: {
          class_id: string
          module_id: string
        }
        Insert: {
          class_id: string
          module_id: string
        }
        Update: {
          class_id?: string
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_classes_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      module_notes: {
        Row: {
          file_name: string
          file_path: string
          id: string
          module_id: string
          title: string
          uploaded_at: string | null
          uploaded_by: string
        }
        Insert: {
          file_name: string
          file_path: string
          id: string
          module_id: string
          title: string
          uploaded_at?: string | null
          uploaded_by: string
        }
        Update: {
          file_name?: string
          file_path?: string
          id?: string
          module_id?: string
          title?: string
          uploaded_at?: string | null
          uploaded_by?: string
        }
        Relationships: []
      }
      modules: {
        Row: {
          code: string
          dept: string | null
          has_practical: boolean
          id: string
          name: string
        }
        Insert: {
          code: string
          dept?: string | null
          has_practical?: boolean
          id: string
          name: string
        }
        Update: {
          code?: string
          dept?: string | null
          has_practical?: boolean
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_dept_fkey"
            columns: ["dept"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          author: string | null
          body: string | null
          date: string | null
          id: string
          priority: string | null
          title: string
        }
        Insert: {
          author?: string | null
          body?: string | null
          date?: string | null
          id: string
          priority?: string | null
          title: string
        }
        Update: {
          author?: string | null
          body?: string | null
          date?: string | null
          id?: string
          priority?: string | null
          title?: string
        }
        Relationships: []
      }
      pay_component_defs: {
        Row: {
          category: string
          code: string
          component_type: string
          created_at: string | null
          default_amount: number | null
          id: string
          is_active: boolean | null
          is_statutory: boolean | null
          is_taxable: boolean | null
          name: string
          sequence: number | null
          updated_at: string | null
        }
        Insert: {
          category: string
          code: string
          component_type: string
          created_at?: string | null
          default_amount?: number | null
          id?: string
          is_active?: boolean | null
          is_statutory?: boolean | null
          is_taxable?: boolean | null
          name: string
          sequence?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          code?: string
          component_type?: string
          created_at?: string | null
          default_amount?: number | null
          id?: string
          is_active?: boolean | null
          is_statutory?: boolean | null
          is_taxable?: boolean | null
          name?: string
          sequence?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payslips: {
        Row: {
          basic_salary: number | null
          benefits_breakdown: Json | null
          created_at: string | null
          deductions_breakdown: Json | null
          earnings_breakdown: Json | null
          employee_id: string | null
          gross_salary: number | null
          id: string
          net_salary: number | null
          notes: string | null
          paye_tax: number | null
          payslip_name: string | null
          period_from: string
          period_to: string
          reference: string
          status: string | null
          total_deductions: number | null
        }
        Insert: {
          basic_salary?: number | null
          benefits_breakdown?: Json | null
          created_at?: string | null
          deductions_breakdown?: Json | null
          earnings_breakdown?: Json | null
          employee_id?: string | null
          gross_salary?: number | null
          id?: string
          net_salary?: number | null
          notes?: string | null
          paye_tax?: number | null
          payslip_name?: string | null
          period_from: string
          period_to: string
          reference: string
          status?: string | null
          total_deductions?: number | null
        }
        Update: {
          basic_salary?: number | null
          benefits_breakdown?: Json | null
          created_at?: string | null
          deductions_breakdown?: Json | null
          earnings_breakdown?: Json | null
          employee_id?: string | null
          gross_salary?: number | null
          id?: string
          net_salary?: number | null
          notes?: string | null
          paye_tax?: number | null
          payslip_name?: string | null
          period_from?: string
          period_to?: string
          reference?: string
          status?: string | null
          total_deductions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          code: string | null
          created_at: string
          dept: string | null
          email: string | null
          id: string
          must_change_password: boolean | null
          name: string
          student_id: string | null
          student_ref: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          dept?: string | null
          email?: string | null
          id?: string
          must_change_password?: boolean | null
          name: string
          student_id?: string | null
          student_ref?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          dept?: string | null
          email?: string | null
          id?: string
          must_change_password?: boolean | null
          name?: string
          student_id?: string | null
          student_ref?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      programme_modules: {
        Row: {
          id: string
          module_id: string
          programme_id: string
          semester: number
          year: number
        }
        Insert: {
          id?: string
          module_id: string
          programme_id: string
          semester: number
          year: number
        }
        Update: {
          id?: string
          module_id?: string
          programme_id?: string
          semester?: number
          year?: number
        }
        Relationships: []
      }
      programmes: {
        Row: {
          id: string
          intake_month: number | null
          intakes: number[] | null
          level: number | null
          name: string
          semesters: number
          start_year: number
          type: string
          years: number
        }
        Insert: {
          id: string
          intake_month?: number | null
          intakes?: number[] | null
          level?: number | null
          name: string
          semesters?: number
          start_year: number
          type?: string
          years?: number
        }
        Update: {
          id?: string
          intake_month?: number | null
          intakes?: number[] | null
          level?: number | null
          name?: string
          semesters?: number
          start_year?: number
          type?: string
          years?: number
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          created_at: string | null
          date: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          capacity: number
          created_at: string | null
          id: string
          name: string
          notes: string | null
          type: string
        }
        Insert: {
          capacity?: number
          created_at?: string | null
          id: string
          name: string
          notes?: string | null
          type?: string
        }
        Update: {
          capacity?: number
          created_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          type?: string
        }
        Relationships: []
      }
      school_config: {
        Row: {
          current_semester: number
          current_term: number
          current_year: number
          id: string
          letter_date: string | null
          offer_letter_signatory: string | null
          offer_letter_signatory_title: string | null
          offer_letter_signature_url: string | null
          school_name: string
          semester_end_date: string | null
          semester_start_date: string | null
          transcript_issuer: string | null
          transcript_issuer_title: string | null
          welcome_letter_signatory: string | null
          welcome_letter_signatory_title: string | null
          welcome_letter_signature_url: string | null
          wl_classes_start: string | null
          wl_induction: string | null
          wl_reg_end: string | null
          wl_reg_start: string | null
          wl_uniform_close: string | null
          wl_uniform_open: string | null
        }
        Insert: {
          current_semester?: number
          current_term?: number
          current_year?: number
          id?: string
          letter_date?: string | null
          offer_letter_signatory?: string | null
          offer_letter_signatory_title?: string | null
          offer_letter_signature_url?: string | null
          school_name?: string
          semester_end_date?: string | null
          semester_start_date?: string | null
          transcript_issuer?: string | null
          transcript_issuer_title?: string | null
          welcome_letter_signatory?: string | null
          welcome_letter_signatory_title?: string | null
          welcome_letter_signature_url?: string | null
          wl_classes_start?: string | null
          wl_induction?: string | null
          wl_reg_end?: string | null
          wl_reg_start?: string | null
          wl_uniform_close?: string | null
          wl_uniform_open?: string | null
        }
        Update: {
          current_semester?: number
          current_term?: number
          current_year?: number
          id?: string
          letter_date?: string | null
          offer_letter_signatory?: string | null
          offer_letter_signatory_title?: string | null
          offer_letter_signature_url?: string | null
          school_name?: string
          semester_end_date?: string | null
          semester_start_date?: string | null
          transcript_issuer?: string | null
          transcript_issuer_title?: string | null
          welcome_letter_signatory?: string | null
          welcome_letter_signatory_title?: string | null
          welcome_letter_signature_url?: string | null
          wl_classes_start?: string | null
          wl_induction?: string | null
          wl_reg_end?: string | null
          wl_reg_start?: string | null
          wl_uniform_close?: string | null
          wl_uniform_open?: string | null
        }
        Relationships: []
      }
      student_modules: {
        Row: {
          added_at: string | null
          added_by: string | null
          id: string
          module_id: string
          student_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          id?: string
          module_id: string
          student_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          id?: string
          module_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_modules_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          class_id: string | null
          completion_date: string | null
          dob: string | null
          email: string | null
          enrolment_date: string | null
          gender: string | null
          guardian: string | null
          guardian_email: string | null
          guardian_mobile: string | null
          id: string
          mobile: string | null
          name: string
          national_id: string | null
          nationality: string | null
          programme: string | null
          progression_status: string | null
          semester: number
          status: string
          student_id: string
          year: number
        }
        Insert: {
          class_id?: string | null
          completion_date?: string | null
          dob?: string | null
          email?: string | null
          enrolment_date?: string | null
          gender?: string | null
          guardian?: string | null
          guardian_email?: string | null
          guardian_mobile?: string | null
          id: string
          mobile?: string | null
          name: string
          national_id?: string | null
          nationality?: string | null
          programme?: string | null
          progression_status?: string | null
          semester?: number
          status?: string
          student_id: string
          year?: number
        }
        Update: {
          class_id?: string | null
          completion_date?: string | null
          dob?: string | null
          email?: string | null
          enrolment_date?: string | null
          gender?: string | null
          guardian?: string | null
          guardian_email?: string | null
          guardian_mobile?: string | null
          id?: string
          mobile?: string | null
          name?: string
          national_id?: string | null
          nationality?: string | null
          programme?: string | null
          progression_status?: string | null
          semester?: number
          status?: string
          student_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_programme_fkey"
            columns: ["programme"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          assignment_id: string | null
          feedback: string | null
          file_data: string | null
          file_name: string | null
          file_size: string | null
          grade: number | null
          id: string
          notes: string | null
          status: string | null
          student_id: string | null
          submitted_date: string | null
          submitted_time: string | null
        }
        Insert: {
          assignment_id?: string | null
          feedback?: string | null
          file_data?: string | null
          file_name?: string | null
          file_size?: string | null
          grade?: number | null
          id: string
          notes?: string | null
          status?: string | null
          student_id?: string | null
          submitted_date?: string | null
          submitted_time?: string | null
        }
        Update: {
          assignment_id?: string | null
          feedback?: string | null
          file_data?: string | null
          file_name?: string | null
          file_size?: string | null
          grade?: number | null
          id?: string
          notes?: string | null
          status?: string | null
          student_id?: string | null
          submitted_date?: string | null
          submitted_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: number
          notes: string | null
          rows_imported: number
          rows_skipped: number
          source: string
          started_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: number
          notes?: string | null
          rows_imported?: number
          rows_skipped?: number
          source?: string
          started_at?: string
          status: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: number
          notes?: string | null
          rows_imported?: number
          rows_skipped?: number
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      terms: {
        Row: {
          end_date: string
          id: string
          name: string
          semester_id: number
          start_date: string
        }
        Insert: {
          end_date: string
          id: string
          name: string
          semester_id: number
          start_date: string
        }
        Update: {
          end_date?: string
          id?: string
          name?: string
          semester_id?: number
          start_date?: string
        }
        Relationships: []
      }
      timetable: {
        Row: {
          class_id: string | null
          date: string | null
          day: string
          id: string
          module_id: string | null
          room: string | null
          session_id: string | null
          time: string
        }
        Insert: {
          class_id?: string | null
          date?: string | null
          day: string
          id: string
          module_id?: string | null
          room?: string | null
          session_id?: string | null
          time: string
        }
        Update: {
          class_id?: string | null
          date?: string | null
          day?: string
          id?: string
          module_id?: string | null
          room?: string | null
          session_id?: string | null
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          related_id: string | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          related_id?: string | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          related_id?: string | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workflow_assignments: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          priority: number
          scope_id: string | null
          scope_type: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          scope_id?: string | null
          scope_type: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          scope_id?: string | null
          scope_type?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_assignments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_instances: {
        Row: {
          completed_at: string | null
          current_stage_id: string | null
          id: string
          request_id: string
          request_type: string
          started_at: string
          status: string
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          current_stage_id?: string | null
          id?: string
          request_id: string
          request_type: string
          started_at?: string
          status?: string
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          current_stage_id?: string | null
          id?: string
          request_id?: string
          request_type?: string
          started_at?: string
          status?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_instances_current_stage_id_fkey"
            columns: ["current_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_instances_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_stage_approvals: {
        Row: {
          acted_at: string
          action: string
          approver_id: string
          comment: string | null
          id: string
          instance_id: string
          stage_id: string
        }
        Insert: {
          acted_at?: string
          action: string
          approver_id: string
          comment?: string | null
          id?: string
          instance_id: string
          stage_id: string
        }
        Update: {
          acted_at?: string
          action?: string
          approver_id?: string
          comment?: string | null
          id?: string
          instance_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_stage_approvals_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "workflow_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_stage_approvals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_stage_owners: {
        Row: {
          created_at: string
          id: string
          owner_type: string
          role_name: string | null
          stage_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          owner_type: string
          role_name?: string | null
          stage_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          owner_type?: string
          role_name?: string | null
          stage_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_stage_owners_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_stages: {
        Row: {
          approval_type: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          stage_key: string
          stage_name: string
          stage_order: number
          workflow_id: string
        }
        Insert: {
          approval_type?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          stage_key: string
          stage_name: string
          stage_order: number
          workflow_id: string
        }
        Update: {
          approval_type?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          stage_key?: string
          stage_name?: string
          stage_order?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_stages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          request_type: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          request_type: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          request_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_username_available: {
        Args: { p_exclude_id?: string; p_username: string }
        Returns: boolean
      }
      current_employee_id: { Args: never; Returns: string }
      get_login_email: { Args: { p_identifier: string }; Returns: string }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_managed_by_current_user: { Args: { emp_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "admin"
        | "hod"
        | "hoy"
        | "lecturer"
        | "student"
        | "hr"
        | "super_admin"
        | "manager"
        | "employee"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "hod",
        "hoy",
        "lecturer",
        "student",
        "hr",
        "super_admin",
        "manager",
        "employee",
      ],
    },
  },
} as const
