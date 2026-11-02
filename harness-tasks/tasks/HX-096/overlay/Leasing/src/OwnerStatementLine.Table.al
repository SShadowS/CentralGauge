table 70340 "CGR Owner Statement Line"
{
    DataClassification = CustomerContent;

    // What we owe a vehicle owner for a month.
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Owner Code"; Code[20]) { }
        field(3; "Vehicle No."; Code[20]) { }
        field(4; "Due Date"; Date) { }
        field(5; Amount; Decimal) { }
        field(6; Open; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
