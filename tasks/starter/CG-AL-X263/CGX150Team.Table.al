table 71343 "CG X150 Team"
{
    Caption = 'CG X150 Team';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Budget No."; Code[20])
        {
            Caption = 'Budget No.';
        }
        field(2; "Department Line No."; Integer)
        {
            Caption = 'Department Line No.';
            TableRelation = "CG X150 Department"."Line No." where("Budget No." = field("Budget No."));
        }
        field(3; "Team Line No."; Integer)
        {
            Caption = 'Team Line No.';
        }
        field(4; "Team Name"; Text[100])
        {
            Caption = 'Team Name';
        }
        field(10; Weight; Decimal)
        {
            Caption = 'Weight';
            DecimalPlaces = 0 : 5;
            MinValue = 0;
        }
        field(11; "Team Amount"; Decimal)
        {
            Caption = 'Team Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Budget No.", "Department Line No.", "Team Line No.")
        {
            Clustered = true;
        }
    }
}
