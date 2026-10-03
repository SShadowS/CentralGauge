table 70310 "CGR Lease Invoice Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { TableRelation = "CGR Lease Contract"; }
        field(2; "Schedule Line No."; Integer) { }
        field(3; "Vehicle No."; Code[20]) { }
        field(4; "Customer Name"; Text[100]) { }
        field(5; "Due Date"; Date) { }
        field(6; "Invoice Date"; Date) { }
        field(7; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Contract No.", "Schedule Line No.") { Clustered = true; }
        key(InvoiceDate; "Invoice Date") { SumIndexFields = Amount; }
    }
}
