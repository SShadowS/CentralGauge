table 71460 "CG X162 Meter Reading"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Meter No."; Code[10])
        {
            DataClassification = CustomerContent;
        }
        field(2; Quantity; Decimal)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Meter No.")
        {
            Clustered = true;
        }
    }
}
