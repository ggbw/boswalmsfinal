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
          status: string
          student_id: string
        }
        Insert: {
          class_id: string
          date: string
          id?: string
          status?: string
          student_id: string
        }
        Update: {
          class_id?: string
          date?: string
          id?: string
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
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
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
      exams: {
        Row: {
          class_id: string | null
          created_by: string | null
          date: string | null
          id: string
          module_id: string | null
          name: string
          status: string | null
          type: string | null
        }
        Insert: {
          class_id?: string | null
          created_by?: string | null
          date?: string | null
          id: string
          module_id?: string | null
          name: string
          status?: string | null
          type?: string | null
        }
        Update: {
          class_id?: string | null
          created_by?: string | null
          date?: string | null
          id?: string
          module_id?: string | null
          name?: string
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
      modules: {
        Row: {
          code: string
          dept: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          dept?: string | null
          id: string
          name: string
        }
        Update: {
          code?: string
          dept?: string | null
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
      profiles: {
        Row: {
          code: string | null
          created_at: string
          dept: string | null
          email: string | null
          id: string
          name: string
          student_id: string | null
          student_ref: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          dept?: string | null
          email?: string | null
          id?: string
          name: string
          student_id?: string | null
          student_ref?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          dept?: string | null
          email?: string | null
          id?: string
          name?: string
          student_id?: string | null
          student_ref?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      programmes: {
        Row: {
          id: string
          level: number | null
          name: string
          semesters: number
          start_year: number
          type: string
          years: number
        }
        Insert: {
          id: string
          level?: number | null
          name: string
          semesters?: number
          start_year: number
          type?: string
          years?: number
        }
        Update: {
          id?: string
          level?: number | null
          name?: string
          semesters?: number
          start_year?: number
          type?: string
          years?: number
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
          school_name: string
        }
        Insert: {
          current_semester?: number
          current_term?: number
          current_year?: number
          id?: string
          school_name?: string
        }
        Update: {
          current_semester?: number
          current_term?: number
          current_year?: number
          id?: string
          school_name?: string
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
          day: string
          id: string
          module_id: string | null
          room: string | null
          time: string
        }
        Insert: {
          class_id?: string | null
          day: string
          id: string
          module_id?: string | null
          room?: string | null
          time: string
        }
        Update: {
          class_id?: string | null
          day?: string
          id?: string
          module_id?: string | null
          room?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
    }
    Enums: {
      app_role: "admin" | "hod" | "hoy" | "lecturer" | "student"
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
      app_role: ["admin", "hod", "hoy", "lecturer", "student"],
    },
  },
} as const
