table 70205 "CGR Rental Ledger Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { TableRelation = "CGR Rental Contract"; }
        field(3; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(4; "Posting Date"; Date) { }
        field(5; Amount; Decimal) { }
        field(6; "Km Driven"; Integer) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", "Posting Date") { SumIndexFields = Amount; }
        key(Contract; "Contract No.") { }
    }
}
