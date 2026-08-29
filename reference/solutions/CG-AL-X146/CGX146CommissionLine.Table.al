table 71302 "CG X146 Commission Line"
{
    Caption = 'CG X146 Commission Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Salesperson Code"; Code[20])
        {
            Caption = 'Salesperson Code';
        }
        field(2; "Base Amount"; Decimal)
        {
            Caption = 'Base Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
        }
        field(3; "Bonus Share"; Decimal)
        {
            Caption = 'Bonus Share';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
        }
    }

    keys
    {
        key(PK; "Salesperson Code")
        {
            Clustered = true;
        }
    }
}
