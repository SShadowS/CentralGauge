table 70372 "CGR Lease Invoice"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { TableRelation = "CGR Lease Contract"; }
        field(3; "Line No."; Integer) { }
        field(4; "Invoice Date"; Date) { }
        field(5; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
