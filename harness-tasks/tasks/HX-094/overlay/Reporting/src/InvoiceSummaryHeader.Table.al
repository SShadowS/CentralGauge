table 70532 "CGR Invoice Summary Header"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Invoice No."; Code[20]) { }
        field(2; "Line Total"; Decimal) { }
        field(3; "Discount Total"; Decimal) { }
        field(4; "Charge Total"; Decimal) { }
        field(5; "Total Excl. Tax"; Decimal) { }
    }

    keys
    {
        key(PK; "Invoice No.") { Clustered = true; }
    }
}
