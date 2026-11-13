table 70170 "CGR Service Visit"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; "Service Plan Code"; Code[20])
        {
            TableRelation = "CGR Service Plan";
            ValidateTableRelation = false;
        }
        field(4; "Service Date"; Date) { }
        field(5; "Service Km"; Integer) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", "Service Date") { }
    }
}
