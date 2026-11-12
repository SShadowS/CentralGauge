table 70180 "CGR Insurance Premium"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Period Start"; Date) { }
        field(3; "Total Amount"; Decimal) { }
        field(4; Allocated; Boolean) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
