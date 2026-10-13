table 70221 "CGR Vehicle Rate"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(2; "Starting Date"; Date) { }
        field(3; "Ending Date"; Date) { }
        field(4; "Daily Rate"; Decimal) { }
    }

    keys
    {
        key(PK; "Vehicle No.", "Starting Date") { Clustered = true; }
    }
}
