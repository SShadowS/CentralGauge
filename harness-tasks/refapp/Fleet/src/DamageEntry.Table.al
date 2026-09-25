table 70101 "CGR Damage Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; Description; Text[100]) { }
        field(4; "Reported On"; Date) { }
        field(5; Repaired; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", Repaired) { }
    }
}
