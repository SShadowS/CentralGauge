table 71493 "CG X165 Route"
{
    DataClassification = CustomerContent;
    Caption = 'CG X165 Route';

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            DataClassification = CustomerContent;
        }
        field(2; "Display Name"; Text[100])
        {
            Caption = 'Display Name';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}
