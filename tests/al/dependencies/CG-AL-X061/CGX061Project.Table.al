table 69005 "CG X061 Project"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Code"; Code[20]) { DataClassification = SystemMetadata; }
        field(2; "Task Count"; Integer)
        {
            FieldClass = FlowField;
            CalcFormula = count("CG X061 Task" where("Project Code" = field("Code")));
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
