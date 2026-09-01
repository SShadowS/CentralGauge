table 71470 "CG X163 Branch Ledger"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Account Code"; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; Amount; Decimal)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Account Code")
        {
            Clustered = true;
        }
    }
}
