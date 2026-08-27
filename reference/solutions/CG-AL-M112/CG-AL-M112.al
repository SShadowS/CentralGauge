table 70112 "CG Project"
{
    Caption = 'CG Project';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            NotBlank = true;
        }
        field(2; Description; Text[100])
        {
            Caption = 'Description';
        }
        field(3; Billable; Boolean)
        {
            Caption = 'Billable';
            InitValue = true;
        }
        field(4; "Total Posted Hours"; Decimal)
        {
            Caption = 'Total Posted Hours';
            FieldClass = FlowField;
            CalcFormula = sum("CG Time Entry".Hours where("Project No." = field("No."), Posted = const(true)));
            Editable = false;
        }
        field(5; "Total Open Hours"; Decimal)
        {
            Caption = 'Total Open Hours';
            FieldClass = FlowField;
            CalcFormula = sum("CG Time Entry".Hours where("Project No." = field("No."), Posted = const(false)));
            Editable = false;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }

    trigger OnDelete()
    var
        CGTimeEntry: Record "CG Time Entry";
    begin
        CGTimeEntry.SetRange("Project No.", "No.");
        if not CGTimeEntry.IsEmpty() then
            Error('Cannot delete project with time entries');
    end;
}

table 70113 "CG Time Entry"
{
    Caption = 'CG Time Entry';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Project No."; Code[20])
        {
            Caption = 'Project No.';
            NotBlank = true;
            TableRelation = "CG Project"."No.";
        }
        field(3; "Entry Date"; Date)
        {
            Caption = 'Entry Date';
        }
        field(4; Hours; Decimal)
        {
            Caption = 'Hours';

            trigger OnValidate()
            begin
                if Hours <= 0 then
                    Error('Hours must be greater than zero');
            end;
        }
        field(5; Posted; Boolean)
        {
            Caption = 'Posted';
            InitValue = false;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }

    trigger OnInsert()
    begin
        if "Entry Date" = 0D then
            "Entry Date" := WorkDate();
    end;
}