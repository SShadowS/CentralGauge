table 71572 "CG X173 Payment Terms"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[10]) { DataClassification = CustomerContent; }
        field(2; "Discount Pct"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
