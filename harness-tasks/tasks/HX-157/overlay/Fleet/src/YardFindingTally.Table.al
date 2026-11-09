table 70141 "CGR Yard Finding Tally"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Open Findings"; Integer) { }
    }

    keys
    {
        key(PK; "Vehicle No.") { Clustered = true; }
    }
}
