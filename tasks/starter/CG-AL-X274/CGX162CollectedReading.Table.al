table 71461 "CG X162 Collected Reading"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Source Company"; Text[30])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Meter No."; Code[10])
        {
            DataClassification = CustomerContent;
        }
        field(3; Quantity; Decimal)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Source Company", "Meter No.")
        {
            Clustered = true;
        }
    }
}
