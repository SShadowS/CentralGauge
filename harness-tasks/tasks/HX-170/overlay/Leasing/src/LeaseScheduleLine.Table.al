table 70301 "CGR Lease Schedule Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { TableRelation = "CGR Lease Contract"; }
        field(2; "Line No."; Integer) { }
        field(3; "Due Date"; Date) { }
        field(4; Amount; Decimal) { }
        field(5; Invoiced; Boolean) { }
        field(6; "Billed Amount"; Decimal) { }
        field(7; "Accounting Ref."; Code[20]) { }
    }

    keys
    {
        key(PK; "Contract No.", "Line No.") { Clustered = true; }
    }
}
