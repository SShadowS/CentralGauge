table 70410 "CG X076 Legacy Amount"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry Code"; Code[20])
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
        key(PK; "Entry Code")
        {
            Clustered = true;
        }
    }
}
