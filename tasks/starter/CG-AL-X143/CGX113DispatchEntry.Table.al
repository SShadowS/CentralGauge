table 70730 "CG X113 Dispatch Entry"
{
    DataClassification = CustomerContent;
    Caption = 'CG X113 Dispatch Entry';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
            DataClassification = CustomerContent;
        }
        field(2; "Dispatcher Code"; Code[20])
        {
            Caption = 'Dispatcher Code';
            DataClassification = CustomerContent;
        }
        field(3; Pending; Boolean)
        {
            Caption = 'Pending';
            DataClassification = CustomerContent;
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
