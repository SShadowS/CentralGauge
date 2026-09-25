// SPIKE (throwaway): harness bench M4-16 premise probe
table 50203 "M16P Committed Row"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
