table 71492 "CG X165 Carrier"
{
    DataClassification = CustomerContent;
    Caption = 'CG X165 Carrier';

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
        field(3; "Surcharge Pct"; Decimal)
        {
            Caption = 'Surcharge Pct';
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
