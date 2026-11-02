table 70241 "CGR Billing Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Customer Name"; Text[100]) { }
        field(3; Days; Decimal) { }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
    }
}
