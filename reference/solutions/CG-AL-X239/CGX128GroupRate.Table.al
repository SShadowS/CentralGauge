table 70882 "CG X128 Group Rate"
{
    DataClassification = CustomerContent;
    DataPerCompany = false;

    fields
    {
        field(1; "Currency Code"; Code[10])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Intercompany Rate"; Decimal)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Currency Code")
        {
            Clustered = true;
        }
    }
}
