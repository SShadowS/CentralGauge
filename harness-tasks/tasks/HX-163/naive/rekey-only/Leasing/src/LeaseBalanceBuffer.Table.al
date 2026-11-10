table 70373 "CGR Lease Balance Buffer"
{
    TableType = Temporary;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Lease No."; Code[20]) { }
        field(3; "Invoiced Amount"; Decimal) { }
        field(4; Invoices; Integer) { }
    }

    keys
    {
        key(PK; "Lease No.") { Clustered = true; }
    }
}
