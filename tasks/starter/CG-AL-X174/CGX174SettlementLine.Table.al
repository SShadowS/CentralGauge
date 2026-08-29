table 71580 "CG X174 Settlement Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Period Code"; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Wallet No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(3; Usage; Decimal)
        {
            DataClassification = CustomerContent;
        }
        field(4; "Cost Share"; Decimal)
        {
            DataClassification = CustomerContent;
            DecimalPlaces = 2 : 2;
        }
    }

    keys
    {
        key(PK; "Period Code", "Wallet No.")
        {
            Clustered = true;
        }
    }
}
