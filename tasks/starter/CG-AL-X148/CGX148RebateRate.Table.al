table 71323 "CG X148 Rebate Rate"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Rebate Group"; Code[10]) { }
        field(2; "Rebate %"; Decimal) { }
    }

    keys
    {
        key(PK; "Rebate Group")
        {
            Clustered = true;
        }
    }
}
