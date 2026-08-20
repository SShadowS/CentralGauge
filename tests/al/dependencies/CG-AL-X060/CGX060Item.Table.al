table 69004 "CG X060 Item"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = SystemMetadata; }
        field(2; Description; Text[100]) { DataClassification = SystemMetadata; }
        field(3; Amount; Integer) { DataClassification = SystemMetadata; }
        field(4; Note; Text[250]) { DataClassification = SystemMetadata; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
