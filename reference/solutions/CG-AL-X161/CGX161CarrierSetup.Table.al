table 71453 "CG X161 Carrier Setup"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Carrier; Enum "CG X161 Carrier") { DataClassification = CustomerContent; }
        field(2; "Max Weight Kg"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; Carrier) { Clustered = true; }
    }
}
