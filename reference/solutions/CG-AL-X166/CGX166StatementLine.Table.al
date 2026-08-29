table 71502 "CG X166 Statement Line"
{
    DataClassification = CustomerContent;
    Caption = 'CG X166 Statement Line';

    fields
    {
        field(1; "Account No."; Code[20])
        {
            Caption = 'Account No.';
            DataClassification = CustomerContent;
        }
        field(2; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            DataClassification = CustomerContent;
        }
        field(3; "Posting Date"; Date)
        {
            Caption = 'Posting Date';
            DataClassification = CustomerContent;
        }
        field(4; Amount; Decimal)
        {
            Caption = 'Amount';
            DataClassification = CustomerContent;
        }
        field(5; "Running Balance"; Decimal)
        {
            Caption = 'Running Balance';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Account No.", "Entry No.")
        {
            Clustered = true;
        }
    }
}
