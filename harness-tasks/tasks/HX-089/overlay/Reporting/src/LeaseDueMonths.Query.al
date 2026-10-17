query 70523 "CGR Lease Due Months"
{
    QueryType = Normal;

    elements
    {
        dataitem(ScheduleLine; "CGR Lease Schedule Line")
        {
            column(ContractNo; "Contract No.") { }
            column(DueYear; "Due Date") { Method = Year; }
            column(DueMonth; "Due Date") { Method = Month; }
            column(Amount; Amount) { Method = Sum; }
            column(Lines) { Method = Count; }
            filter(DueDateFilter; "Due Date") { }
        }
    }
}
