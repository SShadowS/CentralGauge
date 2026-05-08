table 69270 "CG M045 Watched Record"
{
    Caption = 'CG H7 Watched Record';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(10; "Watched Code"; Code[20])
        {
            Caption = 'Watched Code';
        }
        field(20; "Description"; Text[100])
        {
            Caption = 'Description';
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
