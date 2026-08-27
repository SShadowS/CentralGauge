table 71010 "CG X012 Child"
{
    Access = Internal;
    DataClassification = SystemMetadata;
    Caption = 'CG X012 Child';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(2; "Parent Code"; Code[20])
        {
            Caption = 'Parent Code';
            TableRelation = "CG X012 Parent".Code;
        }
        field(3; Data; Text[50])
        {
            Caption = 'Data';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}