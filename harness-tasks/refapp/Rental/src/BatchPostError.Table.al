table 70212 "CGR Batch Post Error"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Batch Id"; Guid) { }
        field(3; "Contract No."; Code[20]) { TableRelation = "CGR Rental Contract"; }
        field(4; "Error Message"; Text[250]) { }
        field(5; "Logged At"; DateTime) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Batch; "Batch Id", "Contract No.") { }
    }
}
