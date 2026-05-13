table 69530 "CG H053 Sale"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Customer No."; Code[20]) { }
        field(3; "Amount"; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ByCustomer; "Customer No.") { IncludedFields = "Amount"; }
    }
}
