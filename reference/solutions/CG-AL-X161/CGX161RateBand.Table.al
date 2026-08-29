table 71451 "CG X161 Rate Band"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Carrier; Enum "CG X161 Carrier") { DataClassification = CustomerContent; }
        field(2; "Band Limit Kg"; Decimal) { DataClassification = CustomerContent; }
        field(3; "Rate Per Kg"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; Carrier, "Band Limit Kg") { Clustered = true; }
    }
}
