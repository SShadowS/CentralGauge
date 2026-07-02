table 69900 "CG X038 Task"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Priority"; Integer) { }
        field(3; "Group Code"; Code[10]) { }
        field(4; "Runs"; Integer) { }
        field(5; "Value"; Integer) { }
    }
    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ByPriority; "Priority") { }
    }
}
