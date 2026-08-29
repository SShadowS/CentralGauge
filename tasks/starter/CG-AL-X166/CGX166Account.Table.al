table 71500 "CG X166 Account"
{
    DataClassification = CustomerContent;
    Caption = 'CG X166 Account';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; Name; Text[100])
        {
            Caption = 'Name';
            DataClassification = CustomerContent;
        }
        field(3; "Closing Balance"; Decimal)
        {
            Caption = 'Closing Balance';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
