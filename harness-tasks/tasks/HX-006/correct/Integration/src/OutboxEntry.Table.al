table 70401 "CGR Outbox Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Event Type"; Text[50]) { }
        field(3; "Vehicle No."; Code[20]) { }
        field(4; Payload; Text[2048]) { }
        field(5; "Created At"; DateTime) { }
        field(6; Sent; Boolean) { }
        field(7; "Vehicle Sequence No."; Integer) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", "Entry No.") { }
    }
}
