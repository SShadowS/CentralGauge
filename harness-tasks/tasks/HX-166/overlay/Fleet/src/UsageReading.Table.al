table 70182 "CGR Usage Reading"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { }
        field(3; "Reading Date"; Date) { }
        field(4; Km; Integer) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", "Reading Date") { }
    }
}
