table 71530 "CG X169 Pricing Setup"
{
    DataClassification = CustomerContent;
    Caption = 'CG X169 Pricing Setup';

    fields
    {
        field(1; "Code"; Code[10])
        {
            Caption = 'Code';
            DataClassification = CustomerContent;
        }
        field(2; "Base Margin Pct"; Decimal)
        {
            Caption = 'Base Margin Pct';
            DataClassification = CustomerContent;
        }
        field(3; "Rounding Precision"; Decimal)
        {
            Caption = 'Rounding Precision';
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
