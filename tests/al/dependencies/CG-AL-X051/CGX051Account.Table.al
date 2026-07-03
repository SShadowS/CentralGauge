table 69111 "CG X051 Account"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(10; Weight; Integer) { }
        field(20; "Kind Filter"; Enum "CG X051 Kind")
        {
            FieldClass = FlowFilter;
        }
        field(30; Balance; Integer)
        {
            FieldClass = FlowField;
            CalcFormula = sum("CG X051 Entry".Amount WHERE("Account No." = FIELD("No."), Kind = FIELD("Kind Filter")));
        }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
