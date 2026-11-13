table 70160 "CGR Workshop Task"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; "Task Type"; Enum "CGR Workshop Task Type") { }
        field(4; "Damage Entry No."; Integer) { TableRelation = "CGR Damage Entry"; }
        field(5; Description; Text[100]) { }
        field(6; "Planned On"; Date) { }
        field(7; Done; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", Done) { }
    }
}
