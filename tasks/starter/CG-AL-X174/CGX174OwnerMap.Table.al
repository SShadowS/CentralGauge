table 71581 "CG X174 Owner Map"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Meter No."; Code[10])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Wallet No."; Code[20])
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
