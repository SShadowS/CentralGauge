table 70124 "CGR Vehicle Substitution"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Substitute Vehicle No."; Code[20]) { }
    }

    keys
    {
        key(PK; "Vehicle No.") { Clustered = true; }
    }
}
