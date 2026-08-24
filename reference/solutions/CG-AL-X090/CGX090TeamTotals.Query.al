query 70552 "CG X090 Team Totals"
{
    QueryType = Normal;

    elements
    {
        dataitem(CaseRec; "CG X090 Case")
        {
            column(AssignedTeam; "Assigned Team")
            {
            }

            dataitem(Adjustment; "CG X090 Adjustment")
            {
                DataItemLink = "Case No." = CaseRec."No.";
                SqlJoinType = LeftOuterJoin;

                column(TotalAmount; Amount)
                {
                    Method = Sum;
                }
            }
        }
    }
}
